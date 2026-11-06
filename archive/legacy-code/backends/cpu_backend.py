"""CPU Backend - DeepSeek-OCR-2 - Compatible with Linux/Mac without GPU"""
from transformers import AutoTokenizer, AutoModel
import torch

DEFAULT_MODEL_PATH = "deepseek-ai/DeepSeek-OCR-2"
DEFAULT_BASE_SIZE = 1024
DEFAULT_IMAGE_SIZE = 768
DEFAULT_CROP_MODE = True

class CPUBackend:
    def __init__(self, model_path: str = DEFAULT_MODEL_PATH):
        self.model_path = model_path
        self.model = None
        self.tokenizer = None
        self.device = "cpu"
        
    def load_model(self):
        """Load model on CPU"""
        try:
            print(f"📦 Loading DeepSeek-OCR-2 on CPU")
            
            self.tokenizer = AutoTokenizer.from_pretrained(
                self.model_path,
                trust_remote_code=True
            )
            
            self.model = AutoModel.from_pretrained(
                self.model_path,
                trust_remote_code=True,
                use_safetensors=True,
                torch_dtype=torch.float32,
                low_cpu_mem_usage=True
            ).eval().to(self.device)
            
            print(f"✅ Model loaded on {self.device}")
            return True
            
        except Exception as e:
            print(f"❌ Model loading failed: {e}")
            raise
    
    def infer(self, prompt: str, image_path: str, **kwargs) -> str:
        """Run inference on CPU"""
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
        """CPU is always available"""
        return True
