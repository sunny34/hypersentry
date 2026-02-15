import asyncio
import json
import logging
import os
from typing import Optional

from src.services.event_bus import EventSubscription, event_bus
from src.ws_manager import manager as ws_manager

logger = logging.getLogger(__name__)


class EventRelay:
    """
    Consumes in-process events and relays them to websocket clients.
    This keeps producers decoupled from direct websocket delivery.
    """

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(EventRelay, cls).__new__(cls)
            cls._instance.is_running = False
            cls._instance._task: Optional[asyncio.Task] = None
            cls._instance._sub: Optional[EventSubscription] = None
            cls._instance._consumer = None
            cls._instance._source = "inproc"
            cls._instance._last_metrics_log_ms = 0
            cls._instance.relayed_count = 0
        return cls._instance

    async def start(self):
        if self.is_running:
            return
        self.is_running = True
        requested_source = os.getenv("EVENT_RELAY_SOURCE", "inproc").strip().lower() or "inproc"
        self._source = requested_source if requested_source in {"inproc", "kafka"} else "inproc"

        if self._source == "kafka":
            connected = await self._start_kafka_consumer()
            if not connected:
                logger.warning("event_relay kafka source unavailable; falling back to inproc")
                self._source = "inproc"

        if self._source == "inproc":
            self._sub = event_bus.subscribe()
        self._task = asyncio.create_task(self._run(), name="event-relay-loop")
        logger.info("event_relay started source=%s", self._source)

    async def stop(self):
        self.is_running = False
        task = self._task
        self._task = None
        if task and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        if self._sub is not None:
            event_bus.unsubscribe(self._sub)
            self._sub = None
        if self._consumer is not None:
            try:
                await self._consumer.stop()
            except Exception:
                logger.exception("event_relay kafka consumer stop failed")
            finally:
                self._consumer = None
        logger.info("event_relay stopped source=%s relayed=%s", self._source, self.relayed_count)

    async def _start_kafka_consumer(self) -> bool:
        try:
            from aiokafka import AIOKafkaConsumer  # type: ignore
        except Exception as exc:
            logger.warning("event_relay kafka unavailable err=%s", exc)
            return False

        bootstrap_servers = [s.strip() for s in os.getenv("EVENT_BUS_KAFKA_BOOTSTRAP_SERVERS", "").split(",") if s.strip()]
        topic = os.getenv("EVENT_BUS_KAFKA_TOPIC", "hypersentry.events").strip()
        group_id = os.getenv("EVENT_RELAY_KAFKA_GROUP_ID", "hypersentry-event-relay").strip() or "hypersentry-event-relay"
        auto_offset_reset = os.getenv("EVENT_RELAY_KAFKA_OFFSET_RESET", "latest").strip() or "latest"

        if not bootstrap_servers or not topic:
            logger.warning(
                "event_relay kafka source not configured bootstrap=%s topic=%s",
                bool(bootstrap_servers),
                bool(topic),
            )
            return False

        try:
            consumer = AIOKafkaConsumer(
                topic,
                bootstrap_servers=bootstrap_servers,
                group_id=group_id,
                enable_auto_commit=True,
                auto_offset_reset=auto_offset_reset,
                value_deserializer=lambda value: json.loads(value.decode("utf-8")) if value else None,
            )
            await consumer.start()
            self._consumer = consumer
            logger.info(
                "event_relay kafka consumer connected topic=%s group_id=%s servers=%s",
                topic,
                group_id,
                bootstrap_servers,
            )
            return True
        except Exception as exc:
            logger.warning("event_relay kafka consumer connect failed err=%s", exc)
            self._consumer = None
            return False

    async def _relay_event(self, event_type: str, data, channel: str = "public", user_id: Optional[str] = None):
        payload = {"type": event_type, "data": data}
        if channel == "private":
            await ws_manager.broadcast(payload, channel="private", user_id=user_id)
        else:
            await ws_manager.broadcast(payload, channel="public")
        self.relayed_count += 1

    async def _run_kafka_once(self):
        consumer = self._consumer
        if consumer is None:
            await asyncio.sleep(0.1)
            return
        try:
            batch = await consumer.getmany(timeout_ms=500, max_records=200)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("event_relay kafka read failed")
            await asyncio.sleep(0.2)
            return

        if not batch:
            return

        for records in batch.values():
            for record in records:
                envelope = record.value if isinstance(record.value, dict) else {}
                event_type = str(envelope.get("event_type") or "").strip()
                if not event_type:
                    continue
                try:
                    await self._relay_event(
                        event_type=event_type,
                        data=envelope.get("data"),
                        channel=str(envelope.get("channel") or "public"),
                        user_id=envelope.get("user_id"),
                    )
                except Exception:
                    logger.exception("event_relay kafka broadcast failed event_type=%s", event_type)

    async def _run(self):
        while self.is_running:
            if self._source == "kafka":
                try:
                    await self._run_kafka_once()
                except asyncio.CancelledError:
                    break
                continue

            sub = self._sub
            if sub is None:
                await asyncio.sleep(0.1)
                continue
            try:
                envelope = await sub.queue.get()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("event_relay queue read failed")
                await asyncio.sleep(0.1)
                continue

            try:
                await self._relay_event(
                    event_type=envelope.event_type,
                    data=envelope.data,
                    channel=envelope.channel,
                    user_id=envelope.user_id,
                )
            except Exception:
                logger.exception("event_relay broadcast failed event_type=%s", envelope.event_type)
            finally:
                try:
                    sub.queue.task_done()
                except Exception:
                    pass


event_relay = EventRelay()
