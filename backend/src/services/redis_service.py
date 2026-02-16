import logging
import redis.asyncio as redis
from config import config

logger = logging.getLogger(__name__)

class RedisService:
    _instance = None
    _client = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(RedisService, cls).__new__(cls)
        return cls._instance

    async def connect(self):
        if self._client is None:
            try:
                self._client = redis.from_url(config.REDIS_URL, decode_responses=True)
                await self._client.ping()
                logger.info("Connected to Redis at %s", config.REDIS_URL)
            except Exception as e:
                logger.error("Failed to connect to Redis: %s", e)
                self._client = None

    async def disconnect(self):
        if self._client:
            await self._client.close()
            self._client = None

    async def get(self, key: str, default=None):
        if not self._client:
            return default
        try:
            val = await self._client.get(key)
            return val if val is not None else default
        except Exception as e:
            logger.error("Redis get failed for key %s: %s", key, e)
            return default

    async def set(self, key: str, value: str, expire: int = None):
        if not self._client:
            return False
        try:
            await self._client.set(key, value, ex=expire)
            return True
        except Exception as e:
            logger.error("Redis set failed for key %s: %s", key, e)
            return False

    async def hgetall(self, name: str):
        if not self._client:
            return {}
        try:
            return await self._client.hgetall(name)
        except Exception as e:
            logger.error("Redis hgetall failed for name %s: %s", name, e)
            return {}

    async def hset(self, name: str, key: str, value: str):
        if not self._client:
            return False
        try:
            await self._client.hset(name, key, value)
            return True
        except Exception as e:
            logger.error("Redis hset failed for name %s, key %s: %s", name, key, e)
            return False

    async def hget(self, name: str, key: str, default=None):
        if not self._client:
            return default
        try:
            val = await self._client.hget(name, key)
            return val if val is not None else default
        except Exception as e:
            logger.error("Redis hget failed for name %s, key %s: %s", name, key, e)
            return default

redis_service = RedisService()
