"""
WebSocket connection hub and live broadcast manager.
"""

import asyncio
from typing import Set, Dict, Any

class AlertWebSocketHub:
    def __init__(self):
        self.active_connections = set()
        
    async def connect(self, websocket):
        self.active_connections.add(websocket)
        
    def disconnect(self, websocket):
        self.active_connections.discard(websocket)
        
    async def broadcast_alert(self, alert_payload: Dict[str, Any]):
        """Broadcast alert payload to all connected clients."""
        if not self.active_connections:
            return
            
        tasks = []
        for ws in list(self.active_connections):
            tasks.append(ws.send_json(alert_payload))
        await asyncio.gather(*tasks, return_exceptions=True)
