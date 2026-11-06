#!/usr/bin/env python3
"""MCP Server for DeepSeek-OCR-2"""
import asyncio
import json
import base64
from typing import Any
import httpx

MCP_VERSION = "2024-11-05"
API_BASE = "http://localhost:8001"

async def call_tool(name: str, arguments: dict) -> list[Any]:
    """Call OCR tool"""
    if name == "ocr_recognize":
        mode = arguments.get("mode", "ocr")
        image_data = arguments.get("image_base64")
        search_text = arguments.get("search_text", "")
        custom_prompt = arguments.get("custom_prompt", "")
        
        async with httpx.AsyncClient(timeout=300.0) as client:
            files = {"file": ("image.png", base64.b64decode(image_data), "image/png")}
            data = {"mode": mode, "search_text": search_text, "custom_prompt": custom_prompt}
            resp = await client.post(f"{API_BASE}/ocr", files=files, data=data)
            result = resp.json()
            
        return [{"type": "text", "text": json.dumps(result, ensure_ascii=False, indent=2)}]
    
    return [{"type": "text", "text": f"Unknown tool: {name}"}]

async def handle_request(request: dict) -> dict:
    """Handle MCP request"""
    method = request.get("method")
    
    if method == "initialize":
        return {
            "protocolVersion": MCP_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "deepseek-ocr", "version": "1.0.0"}
        }
    
    elif method == "tools/list":
        return {
            "tools": [{
                "name": "ocr_recognize",
                "description": "Recognize text from image using DeepSeek-OCR-2",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "image_base64": {"type": "string", "description": "Base64 encoded image"},
                        "mode": {"type": "string", "enum": ["doc", "ocr", "plain", "chart", "image", "find", "custom"], "default": "ocr"},
                        "search_text": {"type": "string", "description": "Text to search (find mode)"},
                        "custom_prompt": {"type": "string", "description": "Custom prompt (custom mode)"}
                    },
                    "required": ["image_base64"]
                }
            }]
        }
    
    elif method == "tools/call":
        params = request.get("params", {})
        result = await call_tool(params["name"], params.get("arguments", {}))
        return {"content": result}
    
    return {"error": {"code": -32601, "message": "Method not found"}}

async def main():
    """Main MCP server loop"""
    import sys
    while True:
        try:
            line = await asyncio.get_event_loop().run_in_executor(None, sys.stdin.readline)
            if not line:
                break
            
            request = json.loads(line)
            response = await handle_request(request)
            response["jsonrpc"] = "2.0"
            response["id"] = request.get("id")
            
            print(json.dumps(response), flush=True)
        except Exception as e:
            error_response = {
                "jsonrpc": "2.0",
                "id": request.get("id") if 'request' in locals() else None,
                "error": {"code": -32603, "message": str(e)}
            }
            print(json.dumps(error_response), flush=True)

if __name__ == "__main__":
    asyncio.run(main())
