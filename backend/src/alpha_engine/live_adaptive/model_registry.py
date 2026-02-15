import os
import pickle
import hmac
import hashlib
import json
import logging
from typing import Dict, List, Optional
from datetime import datetime
from src.alpha_engine.models.governance_models import ModelMetadata

logger = logging.getLogger(__name__)

class ModelRegistry:
    """
    Governance-compliant repository for versioned Alpha Models.
    Ensures full auditability and dynamic model availability.
    """

    def __init__(self, base_path: str = "models/registry"):
        self.base_path = base_path
        self.models_meta: Dict[str, ModelMetadata] = {}
        os.makedirs(base_path, exist_ok=True)
        self.signing_key = os.getenv("MODEL_REGISTRY_SIGNING_KEY", "")
        self._load_registry()

    def _meta_path(self) -> str:
        return os.path.join(self.base_path, "registry_meta.pkl")

    def _sig_path(self) -> str:
        return os.path.join(self.base_path, "registry_meta.sig")

    def _sign(self, payload: bytes) -> str:
        if not self.signing_key:
            return ""
        return hmac.new(self.signing_key.encode("utf-8"), payload, hashlib.sha256).hexdigest()

    def _dump_meta_bytes(self) -> bytes:
        stable = {k: v.model_dump(mode="json") for k, v in self.models_meta.items()}
        return json.dumps(stable, sort_keys=True).encode("utf-8")

    def register_model(self, model: any, metadata: ModelMetadata):
        """
        Persists a new model and its governance metadata.
        """
        path = os.path.join(self.base_path, f"{metadata.model_id}.pkl")
        if os.path.exists(path):
            raise ValueError(f"Model ID {metadata.model_id} already exists.")
            
        with open(path, 'wb') as f:
            pickle.dump(model, f)
            
        self.models_meta[metadata.model_id] = metadata
        self._save_registry_meta()

    def get_active_model(self, regime: str) -> Optional[tuple]:
        """
        Retrieves the best available model for a specific market regime.
        """
        candidates = [m for m in self.models_meta.values() if m.regime_type == regime]
        if not candidates:
            return None
            
        # Sort by deployment timestamp or performance
        best = sorted(candidates, key=lambda x: x.deployment_timestamp, reverse=True)[0]
        
        path = os.path.join(self.base_path, f"{best.model_id}.pkl")
        if not os.path.exists(path):
            logger.error("Model file missing for model_id=%s", best.model_id)
            return None
        with open(path, 'rb') as f:
            model = pickle.load(f)
            
        return model, best

    def _save_registry_meta(self):
        meta_path = self._meta_path()
        with open(meta_path, 'wb') as f:
            pickle.dump(self.models_meta, f)
        sig = self._sign(self._dump_meta_bytes())
        if sig:
            with open(self._sig_path(), "w", encoding="utf-8") as f:
                f.write(sig)

    def _load_registry(self):
        meta_path = self._meta_path()
        if os.path.exists(meta_path):
            with open(meta_path, 'rb') as f:
                self.models_meta = pickle.load(f)
            # Verify signature after load (best-effort integrity check).
            if self.signing_key:
                if os.path.exists(self._sig_path()):
                    with open(self._sig_path(), "r", encoding="utf-8") as f:
                        stored_sig = f.read().strip()
                    actual_sig = self._sign(self._dump_meta_bytes())
                    if stored_sig != actual_sig:
                        logger.error("Registry metadata signature verification failed. Clearing in-memory registry.")
                        self.models_meta = {}
                else:
                    logger.error("Signing key configured but registry signature file missing; clearing in-memory registry.")
                    self.models_meta = {}
