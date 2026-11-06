# MCP Server Setup for DeepSeek-OCR

## What is MCP?

Model Context Protocol (MCP) is an open protocol that enables AI assistants to interact with external tools and services. This MCP server allows AI assistants to use DeepSeek-OCR for image recognition.

## Prerequisites

1. DeepSeek-OCR service running on `http://localhost:8001`
2. Python 3.11+ with `httpx` installed

## Installation

```bash
# Install dependencies
pip install httpx

# Make MCP server executable
chmod +x mcp_server.py
```

## Configuration

### For Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (Mac) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "deepseek-ocr": {
      "command": "python",
      "args": ["/path/to/DeepSeek-OCR-WebUI/mcp_server.py"]
    }
  }
}
```

### For Cline/Other MCP Clients

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "deepseek-ocr": {
      "command": "python",
      "args": ["/absolute/path/to/mcp_server.py"]
    }
  }
}
```

## Usage

Once configured, your AI assistant can use the `ocr_recognize` tool:

**Example prompts:**
- "Use OCR to read this image: [attach image]"
- "Find the word 'Total' in this invoice: [attach image]"
- "Extract all text from this document: [attach image]"

**Tool parameters:**
- `image_base64` (required): Base64 encoded image
- `mode` (optional): Recognition mode (doc/ocr/plain/chart/image/find/custom)
- `search_text` (optional): Text to search in find mode
- `custom_prompt` (optional): Custom prompt in custom mode

## Testing

```bash
# Start DeepSeek-OCR service
docker compose up -d

# Test MCP server manually
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | python mcp_server.py

# Expected output:
# {"tools": [{"name": "ocr_recognize", ...}], "jsonrpc": "2.0", "id": 1}
```

## Troubleshooting

**MCP server not responding:**
- Ensure DeepSeek-OCR service is running: `curl http://localhost:8001/health`
- Check MCP server logs in your AI assistant's console

**Connection refused:**
- Verify API_BASE in mcp_server.py matches your service URL
- Check firewall settings

**Image encoding errors:**
- Ensure images are properly base64 encoded
- Maximum image size: 10MB recommended
