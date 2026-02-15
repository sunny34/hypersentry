import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass
from threading import Lock
from typing import Any, Dict, Optional, Set

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EventEnvelope:
    event_type: str
    data: Any
    ts_ms: int
    source: str
    seq: int
    channel: str = "public"
    symbol: Optional[str] = None
    user_id: Optional[str] = None


@dataclass
class EventSubscription:
    sub_id: int
    queue: asyncio.Queue
    event_types: Optional[Set[str]] = None


class EventPublishBackend:
    name = "inproc"

    async def start(self):
        return

    async def stop(self):
        return

    async def publish(self, envelope: EventEnvelope):
        return

    def stats(self) -> Dict[str, Any]:
        return {"kind": self.name, "connected": True}


class KafkaPublishBackend(EventPublishBackend):
    name = "kafka"

    def __init__(
        self,
        bootstrap_servers: str,
        topic: str,
        client_id: str = "hypersentry-event-bus",
        compression: str = "lz4",
        acks: str = "all",
    ):
        self.bootstrap_servers = bootstrap_servers
        self.topic = topic
        self.client_id = client_id
        self.compression = compression
        self.acks = acks
        self._producer = None
        self._connected = False
        self._error: Optional[str] = None
        self._aiokafka = None

    async def start(self):
        if self._producer is not None:
            return
        try:
            from aiokafka import AIOKafkaProducer  # type: ignore

            self._aiokafka = AIOKafkaProducer
        except Exception as exc:
            self._connected = False
            self._error = f"aiokafka_unavailable:{exc.__class__.__name__}"
            logger.warning("event_bus kafka backend unavailable; falling back to inproc-only fanout err=%s", exc)
            return

        servers = [s.strip() for s in str(self.bootstrap_servers or "").split(",") if s.strip()]
        if not servers:
            self._connected = False
            self._error = "missing_bootstrap_servers"
            logger.warning("event_bus kafka backend disabled: EVENT_BUS_KAFKA_BOOTSTRAP_SERVERS not configured")
            return
        if not self.topic:
            self._connected = False
            self._error = "missing_topic"
            logger.warning("event_bus kafka backend disabled: EVENT_BUS_KAFKA_TOPIC not configured")
            return

        try:
            producer = self._aiokafka(
                bootstrap_servers=servers,
                client_id=self.client_id,
                acks=self.acks,
                compression_type=self.compression,
                value_serializer=lambda value: json.dumps(value, separators=(",", ":"), default=str).encode("utf-8"),
                key_serializer=lambda key: key.encode("utf-8") if isinstance(key, str) else key,
            )
            await producer.start()
            self._producer = producer
            self._connected = True
            self._error = None
            logger.info("event_bus kafka backend connected topic=%s servers=%s", self.topic, servers)
        except Exception as exc:
            self._connected = False
            self._error = f"connect_failed:{exc.__class__.__name__}"
            self._producer = None
            logger.warning("event_bus kafka backend connect failed; inproc-only mode err=%s", exc)

    async def stop(self):
        producer = self._producer
        self._producer = None
        self._connected = False
        if producer is None:
            return
        try:
            await producer.stop()
        except Exception:
            logger.exception("event_bus kafka producer stop failed")

    async def publish(self, envelope: EventEnvelope):
        producer = self._producer
        if producer is None:
            return

        payload = {
            "event_type": envelope.event_type,
            "data": envelope.data,
            "ts_ms": envelope.ts_ms,
            "source": envelope.source,
            "seq": envelope.seq,
            "channel": envelope.channel,
            "symbol": envelope.symbol,
            "user_id": envelope.user_id,
        }
        key = envelope.user_id or envelope.symbol or envelope.event_type
        try:
            await producer.send_and_wait(self.topic, payload, key=key)
        except Exception as exc:
            self._connected = False
            self._error = f"publish_failed:{exc.__class__.__name__}"
            logger.warning("event_bus kafka publish failed topic=%s event_type=%s err=%s", self.topic, envelope.event_type, exc)

    def stats(self) -> Dict[str, Any]:
        return {
            "kind": self.name,
            "connected": bool(self._connected),
            "topic": self.topic,
            "bootstrap_servers": self.bootstrap_servers,
            "error": self._error,
        }


class InProcessEventBus:
    """
    Lightweight in-memory event bus to decouple producers from WS/API delivery.
    This is the migration bridge before external bus adoption (Kafka/NATS).
    """

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(InProcessEventBus, cls).__new__(cls)
            cls._instance._subs: Dict[int, EventSubscription] = {}
            cls._instance._sub_id = 0
            cls._instance._seq_by_source: Dict[str, int] = {}
            cls._instance._lock = Lock()
            cls._instance.published_count = 0
            cls._instance.dropped_count = 0
            cls._instance._started = False
            cls._instance._configured_backend = "inproc"
            cls._instance._backend: EventPublishBackend = EventPublishBackend()
            cls._instance._configure_backend_from_env()
        return cls._instance

    def _configure_backend_from_env(self):
        backend = os.getenv("EVENT_BUS_BACKEND", "inproc").strip().lower()
        self._configured_backend = backend if backend else "inproc"
        self._backend = self._build_backend(self._configured_backend)

    def _build_backend(self, backend: str) -> EventPublishBackend:
        if backend == "kafka":
            return KafkaPublishBackend(
                bootstrap_servers=os.getenv("EVENT_BUS_KAFKA_BOOTSTRAP_SERVERS", ""),
                topic=os.getenv("EVENT_BUS_KAFKA_TOPIC", "hypersentry.events"),
                client_id=os.getenv("EVENT_BUS_KAFKA_CLIENT_ID", "hypersentry-event-bus"),
                compression=os.getenv("EVENT_BUS_KAFKA_COMPRESSION", "lz4"),
                acks=os.getenv("EVENT_BUS_KAFKA_ACKS", "all"),
            )
        return EventPublishBackend()

    async def start(self):
        if self._started:
            return
        self._started = True
        await self._backend.start()
        logger.info("event_bus started backend=%s", self._configured_backend)

    async def stop(self):
        if not self._started:
            return
        self._started = False
        await self._backend.stop()
        logger.info("event_bus stopped backend=%s", self._configured_backend)

    async def use_backend(self, backend: str):
        requested = (backend or "inproc").strip().lower() or "inproc"
        was_started = self._started
        if was_started:
            await self._backend.stop()
        self._configured_backend = requested
        self._backend = self._build_backend(requested)
        if was_started:
            await self._backend.start()
        logger.info("event_bus backend switched to=%s", requested)

    def subscribe(self, event_types: Optional[Set[str]] = None, max_queue_size: int = 2000) -> EventSubscription:
        normalized = {e for e in (event_types or set()) if e} or None
        queue: asyncio.Queue = asyncio.Queue(maxsize=max(100, int(max_queue_size)))
        with self._lock:
            self._sub_id += 1
            sub = EventSubscription(sub_id=self._sub_id, queue=queue, event_types=normalized)
            self._subs[sub.sub_id] = sub
        logger.info(
            "event_bus subscribe sub_id=%s filters=%s total=%s",
            sub.sub_id,
            sorted(list(normalized)) if normalized else "ALL",
            len(self._subs),
        )
        return sub

    def unsubscribe(self, sub: EventSubscription):
        with self._lock:
            removed = self._subs.pop(sub.sub_id, None)
        if removed is not None:
            logger.info("event_bus unsubscribe sub_id=%s total=%s", sub.sub_id, len(self._subs))

    def _next_seq(self, source: str) -> int:
        with self._lock:
            nxt = int(self._seq_by_source.get(source, 0) + 1)
            self._seq_by_source[source] = nxt
        return nxt

    async def publish(
        self,
        event_type: str,
        data: Any,
        *,
        source: str = "system",
        channel: str = "public",
        symbol: Optional[str] = None,
        user_id: Optional[str] = None,
        ts_ms: Optional[int] = None,
    ) -> EventEnvelope:
        if not event_type:
            raise ValueError("event_type is required")

        envelope = EventEnvelope(
            event_type=event_type,
            data=data,
            ts_ms=int(ts_ms or int(time.time() * 1000)),
            source=source,
            seq=self._next_seq(source),
            channel=channel,
            symbol=symbol,
            user_id=user_id,
        )

        with self._lock:
            subscriptions = list(self._subs.values())

        for sub in subscriptions:
            if sub.event_types and event_type not in sub.event_types:
                continue
            try:
                sub.queue.put_nowait(envelope)
            except asyncio.QueueFull:
                self.dropped_count += 1

        try:
            await self._backend.publish(envelope)
        except Exception:
            logger.exception("event_bus backend publish error event_type=%s", event_type)

        self.published_count += 1
        return envelope

    def stats(self) -> Dict[str, Any]:
        with self._lock:
            total_subs = len(self._subs)
        return {
            "subscriptions": total_subs,
            "published_count": int(self.published_count),
            "dropped_count": int(self.dropped_count),
            "backend": {
                "configured": self._configured_backend,
                **self._backend.stats(),
                "started": bool(self._started),
            },
        }

    def _reset_for_tests(self):
        with self._lock:
            self._subs.clear()
            self._sub_id = 0
            self._seq_by_source.clear()
        self.published_count = 0
        self.dropped_count = 0


event_bus = InProcessEventBus()
