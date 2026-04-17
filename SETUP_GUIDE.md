# ForgeSight - Setup & Run Guide

## Prerequisites
- Python 3.8 or higher
- pip (Python package manager)
- Telegram Bot Token (already configured)

## Step 1: Install Dependencies

Open a terminal in the project root directory and run:

```bash
pip install -r requirements.txt
```

This will install:
- FastAPI (backend framework)
- Uvicorn (ASGI server)
- Python-Telegram-Bot (for Telegram integration)
- Pydantic (data validation)
- httpx (HTTP client)

## Step 2: Start the Backend Server

In the first terminal, run:

```bash
python run.py
```

You should see:
```
[FORGESIGHT] Starting predictive maintenance agent...
INFO:     Started server process [XXXX]
INFO:     Uvicorn running on http://0.0.0.0:8000
```

The backend will be available at: `http://localhost:8000`

## Step 3: Start the Telegram Bot

Open a second terminal and run:

```bash
cd /workspaces/ForgeSight
python -m backend.bot
```

You should see:
```
[BOT] ForgeSight Telegram Bot is starting...
[BOT] Available commands: /start, /status, /machines, /help
```

## Step 4: Use the Bot in Telegram

Search for your bot on Telegram and send these commands:

### Commands Available:

**`/start`** - Welcome message with command list
```
🤖 ForgeSight - Predictive Maintenance Bot

Available Commands:
• /status - View all machine alerts and priority queue
• /machines - List all monitored machines
• /help - Show this help message
```

**`/status`** - View all critical machine alerts (MAIN COMMAND)
```
Shows:
1. Priority queue (machines sorted by risk score)
2. Count of active alerts
3. Machine selection buttons with risk scores
4. Click any machine for full details + LLM analysis
5. Back button to return to machine list
```

**`/machines`** - List all monitored machines
```
Shows:
• CNC_01
• CNC_02
• PUMP_03
• CONVEYOR_04
```

**`/help`** - Detailed help documentation

## Alert Format Example

When you use `/status`, you'll receive alerts like:

```
⚠️ CRITICAL ALERT – CNC_01
────────────────────────────────────────

📌 Issue Type: COMPOUND
📊 Status: [COMPOUND] 2 sensor(s) anomalous
Risk Score: 89 (CRITICAL)
🎯 Priority Level: 🔴 CRITICAL

⚡ Affected Sensors:
   • temperature_C
   • vibration_mm_s

🔗 Dashboard:
http://yourapp.com/machine/CNC_01

💡 DETAILED ANALYSIS:
CRITICAL — immediate intervention required. Vibration Mm S reads 1.2, 
exceeding the upper bound of 1.0 by 12.1 standard deviations; Current A 
reads 9.2, exceeding the upper bound of 8.9 by 2.1 standard deviations. 
Anomalies across 2 sensors simultaneously suggest a possible systemic 
issue...
```

## Priority Queue Format

```
📋 PRIORITY QUEUE (Ranked by Risk Score)
────────────────────────────────────────

1. 🔴 CNC_01
   Risk: 89 | Priority: CRITICAL
   Reason: [COMPOUND] 2 sensor(s) anomalous

2. 🟠 PUMP_03
   Risk: 65 | Priority: HIGH
   Reason: [DRIFT] vibration_mm_s drifting

3. 🟡 CONVEYOR_04
   Risk: 45 | Priority: MEDIUM
   Reason: [SPIKE] temperature_C spike detected
```

## Troubleshooting

### Error: "Can't parse entities: can't find end of the entity..."
**Solution**: This has been fixed in the latest version. Make sure you've downloaded the updated bot.py

### Error: "All connection attempts failed"
**Solution**: 
- Make sure the backend server is running (Step 2)
- Check that it's running on `http://localhost:8000`
- Wait 5-10 seconds after starting backend before using bot commands

### Bot doesn't respond to `/status`
**Solution**:
1. Check if backend is running: `http://localhost:8000` should load in browser
2. Check if bot is running in second terminal
3. Try `/help` first
4. Wait 10 seconds and try again

### Connection refused on localhost:8000
**Solution**:
- Backend server is not running or crashed
- Restart with: `python run.py`
- Check for error messages in the terminal

## File Structure

```
ForgeSight/
├── run.py                 # Backend startup script
├── requirements.txt       # Python dependencies
├── backend/
│   ├── main.py           # FastAPI app
│   ├── agent.py          # Predictive maintenance agent
│   ├── bot.py            # Telegram bot (MAIN BOT FILE)
│   ├── models.py         # Data models
│   ├── mock_data.py      # Test data
│   └── llm_client.py     # LLM integration
└── frontend/
    ├── index.html        # Web dashboard
    ├── app.js            # Frontend logic
    └── styles.css        # Styling
```

## Running Both Services Together (Recommended)

You can use this bash script or run in two separate terminals:

**Terminal 1:**
```bash
cd /workspaces/ForgeSight
python run.py
```

**Terminal 2:**
```bash
cd /workspaces/ForgeSight
python -m backend.bot
```

## Backend API Endpoints (Used by Bot)

The bot communicates with these endpoints:

- `GET /api/alerts` - Fetch all machine alerts
- `GET /api/priority-queue` - Fetch priority queue sorted by risk
- `GET /api/maintenance` - Fetch maintenance schedules
- `GET /api/baselines/{machine_id}` - Fetch baseline data

## Testing the Bot

1. **No Alerts**: Bot responds with "✅ All systems operational!"
2. **With Alerts**: Bot shows priority queue and machine selection buttons
3. **Click Machine**: Shows detailed alert for that specific machine
4. **Back Button**: Returns to machine selection list

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| Bot not responding | Restart bot with `python -m backend.bot` |
| Backend connection error | Ensure `python run.py` is running in another terminal |
| Telegram parse error | Clear cache and restart both services |
| No machines in list | Backend hasn't generated any machine data yet |
| Button clicks do nothing | Backend may have crashed, check terminal output |

## Next Steps

1. Start both services (backend + bot)
2. Open Telegram and send `/status`
3. Monitor machine alerts in real-time
4. Click machines to view detailed status
5. Check priority queue for machines needing maintenance

**Happy monitoring! 🚀**
