"""CUDA Backend for NVIDIA GPUs - DeepSeek-OCR-2"""
import os
from transformers import AutoTokenizer, AutoModel
import torch

# DeepSeek-OCR-2 default parameters (from official config)
DEFAULT_MODEL_PATH = "deepseek-ai/DeepSeek-OCR-2"
DEFAULT_BASE_SIZE = int(os.environ.get("OCR_BASE_SIZE", "1024"))
DEFAULT_IMAGE_SIZE = int(os.environ.get("OCR_IMAGE_SIZE", "768"))
DEFAULT_CROP_MODE = os.environ.get("OCR_CROP_MODE", "true").strip().lower() in ("1", "true", "yes", "on")

class CUDABackend:
    def __init__(self, model_path: str = DEFAULT_MODEL_PATH):
        self.model_path = model_path
        self.model = None
        self.tokenizer = None
        
    @staticmethod
    def get_optimal_dtype():
        """Get optimal dtype based on GPU capability"""
        if not torch.cuda.is_available():
            return torch.float32
        
        capability = torch.cuda.get_device_capability()
        if capability[0] >= 8:
            return torch.bfloat16
        else:
            print(f"⚠️ GPU compute capability {capability[0]}.{capability[1]} < 8.0, using float16 instead of bfloat16")
            return torch.float16
        
    def load_model(self, source: str = "huggingface", timeout: int = 300):
        """Load CUDA model"""
        try:
            print(f"📦 Loading DeepSeek-OCR-2 on CUDA")
            
            if source == "modelscope":
                from modelscope import snapshot_download
                local_path = snapshot_download(
                    model_id=self.model_path,
                    cache_dir=os.environ.get('MODELSCOPE_CACHE', '~/.cache/modelscope'),
                    revision='master'
                )
                model_path = local_path
            else:
                os.environ['HF_HUB_DOWNLOAD_TIMEOUT'] = str(timeout)
                model_path = self.model_path
            
            self.tokenizer = AutoTokenizer.from_pretrained(
                model_path,
                trust_remote_code=True
            )
            
            optimal_dtype = self.get_optimal_dtype()
            print(f"📊 Using dtype: {optimal_dtype}")
            
            # Use flash_attention_2 for CUDA (recommended by OCR-2)
            self.model = AutoModel.from_pretrained(
                model_path,
                _attn_implementation='flash_attention_2',
                trust_remote_code=True,
                use_safetensors=True,
                torch_dtype=optimal_dtype,
                low_cpu_mem_usage=True
            ).eval().to("cuda")
            
            print(f"✅ Model loaded on CUDA from {source}")
            return True
            
        except Exception as e:
            print(f"❌ Model loading failed: {e}")
            raise
    
    def infer(self, prompt: str, image_path: str, **kwargs) -> str:
        """Run inference on CUDA"""
        fallback_profiles = [
            (DEFAULT_BASE_SIZE, DEFAULT_IMAGE_SIZE, DEFAULT_CROP_MODE),
            (DEFAULT_BASE_SIZE, DEFAULT_IMAGE_SIZE, True),
            (640, 448, True),
            (576, 384, True),
            (512, 320, True),
        ]
        seen = set()
        last_error = None

        for base_size, image_size, crop_mode in fallback_profiles:
            profile = (base_size, image_size, crop_mode)
            if profile in seen:
                continue
            seen.add(profile)

            try:
                print(
                    f"🧪 Inference profile: base_size={base_size}, image_size={image_size}, crop_mode={crop_mode}"
                )
                result = self.model.infer(
                    tokenizer=self.tokenizer,
                    prompt=prompt,
                    image_file=image_path,
                    output_path='./output',
                    base_size=base_size,
                    image_size=image_size,
                    crop_mode=crop_mode,
                    save_results=False,
                    eval_mode=True
                )
                return result if result else ""
            except Exception as e:
                last_error = e
                msg = str(e)
                # Upstream OCR-2 bug path: param_img is undefined when crop_mode=False.
                if "param_img" in msg and not crop_mode:
                    print(f"⚠️ Upstream param_img bug with crop_mode={crop_mode}, retrying with crop_mode=True")
                    continue
                if isinstance(e, torch.OutOfMemoryError) or "out of memory" in msg.lower():
                    print(f"⚠️ CUDA OOM with profile {profile}, trying smaller profile...")
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                    continue
                print(f"❌ Inference failed: {e}")
                raise

        print(f"❌ Inference failed after all fallback profiles: {last_error}")
        raise last_error
    
    @staticmethod
    def is_available() -> bool:
        """Check if CUDA is available"""
        try:
            import torch
            return torch.cuda.is_available()
        except ImportError:
            return False
