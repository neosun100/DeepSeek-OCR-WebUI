#!/usr/bin/env python3
"""
GPU Resource Manager - Lazy Load + Instant Offload
懒加载 + 即用即卸的 GPU 显存管理
"""
import time
import threading
import logging
import torch
import gc
from typing import Optional, Callable

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class GPUResourceManager:
    """GPU 资源管理器"""
    
    def __init__(self, idle_timeout: int = 60):
        """
        Args:
            idle_timeout: 空闲超时时间（秒）
        """
        self.idle_timeout = idle_timeout
        self.model = None  # GPU 上的模型
        self.model_on_cpu = None  # CPU 缓存
        self.processor = None
        self.lock = threading.Lock()
        self.last_use_time = 0
        self.running = False
        self.monitor_thread = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        
        logger.info(f"🎯 GPU Manager initialized (device={self.device}, timeout={idle_timeout}s)")
    
    def get_model(self, load_func: Callable):
        """
        懒加载逻辑：
        1. 如果在 GPU 上 → 直接返回
        2. 如果在 CPU 上 → 快速转移到 GPU（2-5秒）
        3. 如果未加载 → 从磁盘加载（首次 20-30秒）
        """
        with self.lock:
            self.last_use_time = time.time()
            
            # 情况1: 已在 GPU 上
            if self.model is not None:
                logger.info("✅ Model already on GPU")
                return self.model, self.processor
            
            # 情况2: 在 CPU 缓存中，快速转移
            if self.model_on_cpu is not None:
                logger.info("🔄 Moving model from CPU to GPU...")
                start = time.time()
                self.model = self.model_on_cpu.to(self.device)
                self.model_on_cpu = None
                logger.info(f"✅ Model moved to GPU in {time.time()-start:.1f}s")
                return self.model, self.processor
            
            # 情况3: 首次加载
            logger.info("📥 Loading model from disk (first time)...")
            start = time.time()
            self.model, self.processor = load_func()
            logger.info(f"✅ Model loaded in {time.time()-start:.1f}s")
            return self.model, self.processor
    
    def force_offload(self):
        """
        即用即卸：任务完成后立即调用
        将模型从 GPU 转移到 CPU，释放显存
        """
        with self.lock:
            if self.model is not None:
                logger.info("💾 Offloading model to CPU...")
                start = time.time()
                self._move_to_cpu()
                logger.info(f"✅ Model offloaded in {time.time()-start:.1f}s")
    
    def force_release(self):
        """
        完全释放：长期不用时调用
        清空 GPU 和 CPU 缓存
        """
        with self.lock:
            logger.info("🗑️ Releasing all resources...")
            self.model = None
            self.model_on_cpu = None
            self.processor = None
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            logger.info("✅ All resources released")
    
    def _move_to_cpu(self):
        """内部方法：将模型移到 CPU"""
        if self.model is not None:
            self.model_on_cpu = self.model.cpu()
            self.model = None
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
    
    def start_monitor(self):
        """启动监控线程"""
        if self.running:
            return
        
        self.running = True
        self.monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.monitor_thread.start()
        logger.info("🔍 Monitor thread started")
    
    def stop_monitor(self):
        """停止监控线程"""
        self.running = False
        if self.monitor_thread:
            self.monitor_thread.join(timeout=5)
        logger.info("🛑 Monitor thread stopped")
    
    def _monitor_loop(self):
        """监控循环：自动卸载空闲模型"""
        while self.running:
            time.sleep(30)  # 每30秒检查
            
            # 暂时禁用自动卸载，避免推理过程中被卸载
            # with self.lock:
            #     if self.model is not None:
            #         idle_time = time.time() - self.last_use_time
            #         
            #         if idle_time > self.idle_timeout:
            #             logger.info(f"⏰ Idle for {idle_time:.0f}s, auto-offloading...")
            #             self._move_to_cpu()
    
    def get_status(self) -> dict:
        """获取当前状态"""
        with self.lock:
            status = {
                "model_location": "gpu" if self.model is not None else ("cpu" if self.model_on_cpu is not None else "unloaded"),
                "idle_time": time.time() - self.last_use_time if self.last_use_time > 0 else 0,
                "device": self.device,
                "timeout": self.idle_timeout
            }
            
            if torch.cuda.is_available():
                status["gpu_memory_allocated"] = torch.cuda.memory_allocated() / 1024**2  # MB
                status["gpu_memory_reserved"] = torch.cuda.memory_reserved() / 1024**2  # MB
            
            return status
