"""Transformers Backend for CPU/MPS - DeepSeek-OCR-2 (generate-based fallback)"""
from PIL import Image
from transformers import AutoTokenizer, AutoModel
import torch

DEFAULT_MODEL_PATH = "deepseek-ai/DeepSeek-OCR-2"
DEFAULT_BASE_SIZE = 1024
DEFAULT_IMAGE_SIZE = 768
DEFAULT_CROP_MODE = True

class TransformersBackend:
    def __init__(self, model_path: str = DEFAULT_MODEL_PATH):
        self.model_path = model_path
        self.model = None
        self.tokenizer = None
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        
    def load_model(self):
        """Load model with transformers"""
        try:
            print(f"📦 Loading DeepSeek-OCR-2: {self.model_path} on {self.device}")
            self.tokenizer = AutoTokenizer.from_pretrained(
                self.model_path,
                trust_remote_code=True
            )
            self.model = AutoModel.from_pretrained(
                self.model_path,
                trust_remote_code=True,
                use_safetensors=True,
                torch_dtype=torch.float16 if self.device == "mps" else torch.float32
            ).eval().to(self.device)
            print(f"✅ Model loaded successfully on {self.device}")
            return True
        except Exception as e:
            print(f"❌ Model loading failed: {e}")
            raise
    
    def infer(self, prompt: str, image_path: str, **kwargs) -> str:
        """Run inference via model.infer()"""
        try:
            result = self.model.infer(
                tokenizer=self.tokenizer,
                prompt=prompt,
                image_file=image_path,
                output_path='./output',
                base_size=DEFAULT_BASE_SIZE,
                image_size=DEFAULT_IMAGE_SIZE,
                crop_mode=DEFAULT_CROP_MODE,
                save_results=False,
                eval_mode=True
            )
            return result if result else ""
        except Exception as e:
            print(f"❌ Inference failed: {e}")
            raise
    
    @staticmethod
    def is_available() -> bool:
        """Always available if torch is installed"""
        try:
            import torch
            return True
        except ImportError:
            return False
