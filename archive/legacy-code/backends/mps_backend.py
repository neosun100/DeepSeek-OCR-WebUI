"""MPS Backend for Apple Silicon - DeepSeek-OCR-2"""
from transformers import AutoTokenizer, AutoModel
import torch
import platform

DEFAULT_MODEL_PATH = "deepseek-ai/DeepSeek-OCR-2"
DEFAULT_BASE_SIZE = 1024
DEFAULT_IMAGE_SIZE = 768
DEFAULT_CROP_MODE = True

class MPSBackend:
    def __init__(self, model_path: str = DEFAULT_MODEL_PATH):
        self.model_path = model_path
        self.model = None
        self.tokenizer = None
        self.device = "mps"
        
    def load_model(self):
        """Load model with MPS acceleration"""
        try:
            print(f"📦 Loading DeepSeek-OCR-2 with MPS")
            
            self.tokenizer = AutoTokenizer.from_pretrained(
                self.model_path,
                trust_remote_code=True
            )
            
            # MPS: no flash_attention_2, use eager; float32 for compatibility
            self.model = AutoModel.from_pretrained(
                self.model_path,
                trust_remote_code=True,
                use_safetensors=True,
                torch_dtype=torch.float32,
                low_cpu_mem_usage=True,
                attn_implementation="eager"
            ).eval().to(self.device)
            
            print(f"✅ Model loaded on {self.device}")
            return True
            
        except Exception as e:
            print(f"❌ Model loading failed: {e}")
            raise
    
    def infer(self, prompt: str, image_path: str, **kwargs) -> str:
        """Run inference using model's infer method"""
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
        """Check if MPS is available"""
        try:
            import torch
            return (platform.system() == "Darwin" and 
                    platform.machine() == "arm64" and
                    torch.backends.mps.is_available())
        except ImportError:
            return False
