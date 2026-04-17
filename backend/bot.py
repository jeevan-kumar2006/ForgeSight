from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, CallbackQueryHandler, filters, ContextTypes
import httpx
import asyncio

TOKEN = "8537061446:AAHMJwAakwLX898rC4q_TYlCI18RrfxfanM"
BACKEND_URL = "http://localhost:8000"

# ─── Helper Functions ──────────────────────────────────────────────────────────

async def fetch_alerts():
    """Fetch all alerts from backend"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{BACKEND_URL}/api/alerts")
            resp.raise_for_status()
            return resp.json()
    except httpx.ConnectError:
        print(f"[BOT] Cannot connect to backend at {BACKEND_URL}")
        return []
    except Exception as e:
        print(f"[BOT] Error fetching alerts: {e}")
        return []

async def fetch_priority_queue():
    """Fetch priority queue from backend"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{BACKEND_URL}/api/priority-queue")
            resp.raise_for_status()
            return resp.json()
    except httpx.ConnectError:
        print(f"[BOT] Cannot connect to backend at {BACKEND_URL}")
        return []
    except Exception as e:
        print(f"[BOT] Error fetching priority queue: {e}")
        return []

def format_alert_message(alert: dict) -> str:
    """Format a single alert for display"""
    machine_id = alert.get("machine_id", "UNKNOWN")
    risk_score = alert.get("risk_score", 0)
    priority = alert.get("priority", "unknown").upper()
    reason = alert.get("reason_summary", "Unknown issue")
    anomaly_type = alert.get("anomaly_type", "unknown").upper()
    
    # Get sensor data from anomalies if available
    sensors_affected = alert.get("sensors_affected", [])
    
    # Create priority emoji
    if priority == "CRITICAL":
        priority_emoji = "🔴 CRITICAL"
    elif priority == "HIGH":
        priority_emoji = "🟠 HIGH"
    elif priority == "MEDIUM":
        priority_emoji = "🟡 MEDIUM"
    else:
        priority_emoji = "🟢 " + priority
    
    message = f"⚠️ CRITICAL ALERT – {machine_id}\n"
    message += f"{'─' * 40}\n\n"
    
    message += f"📌 Issue Type: {anomaly_type}\n"
    message += f"📊 Status: {reason}\n\n"
    
    message += f"🚨 Risk Score: {risk_score}\n"
    message += f"🎯 Priority Level: {priority_emoji}\n\n"
    
    if sensors_affected:
        message += f"⚡ Affected Sensors:\n"
        for sensor in sensors_affected:
            message += f"   • {sensor}\n"
        message += "\n"
    
    
    return message

def format_priority_queue_message(priority_queue: list) -> str:
    """Format priority queue for display"""
    if not priority_queue:
        return "✅ No critical machines in priority queue"
    
    message = "📋 PRIORITY QUEUE (Ranked by Risk Score)\n"
    message += "─" * 40 + "\n\n"
    
    for idx, item in enumerate(priority_queue[:10], 1):
        machine_id = item.get("machine_id", "UNKNOWN")
        risk_score = item.get("risk_score", 0)
        priority = item.get("priority", "unknown").upper()
        reason = item.get("reason", "")
        
        emoji = "🔴" if priority == "CRITICAL" else "🟠" if priority == "HIGH" else "🟡"
        
        message += f"{idx}. {emoji} {machine_id}\n"
        message += f"   Risk: {risk_score} | Priority: {priority}\n"
        if reason:
            reason_text = reason[:60].replace('[', '').replace(']', '').replace('*', '').replace('_', '')
            message += f"   Reason: {reason_text}...\n" if len(reason) > 60 else f"   Reason: {reason_text}\n"
        message += "\n"
    
    return message

# ─── Command Handlers ──────────────────────────────────────────────────────────

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Start command"""
    welcome_text = (
        "🤖 ForgeSight - Predictive Maintenance Bot\n\n"
        "Available Commands:\n"
        "• /status - View all machine alerts and priority queue\n"
        "• /machines - List all monitored machines\n"
        "• /help - Show this help message\n\n"
        "Type /status to get started!"
    )
    await update.message.reply_text(welcome_text)

async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Help command"""
    help_text = (
        "📖 ForgeSight Bot - Help\n\n"
        "Available Commands:\n"
        "• /status - View real-time alerts and priority queue\n"
        "• /machines - See list of monitored machines\n"
        "• /help - Show this message\n\n"
        "How to Use:\n"
        "1. Type /status to see all critical alerts\n"
        "2. Click inline buttons to view specific machine details\n"
        "3. Monitor priority queue for machines needing attention"
    )
    await update.message.reply_text(help_text)

async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    /status command - Fetch and display all alerts with priority queue
    Shows alerts and machine selection buttons
    """
    try:
        await update.message.reply_text("⏳ Fetching real-time data...\n(This may take a few seconds)")
        
        # Fetch both alerts and priority queue
        alerts = await fetch_alerts()
        priority_queue = await fetch_priority_queue()
        
        if not alerts:
            await update.message.reply_text(
                "✅ All systems operational!\n\n"
                "No critical alerts at this time.\n"
                "All machines are running within normal parameters."
            )
            return
        
        # Display priority queue first
        pq_message = format_priority_queue_message(priority_queue)
        await update.message.reply_text(pq_message)
        
        # Display alert summary
        await update.message.reply_text(
            "🚨 CRITICAL ALERTS DETECTED\n"
            "\n\n"
            "Found " + str(len(alerts)) + " active alert(s)\n\n"
            "Select a machine below to view full details and analysis:"
        )
        
        # Group alerts by machine
        machines_with_alerts = {}
        for alert in alerts[:20]:  # Show top 20 alerts
            machine_id = alert.get("machine_id", "UNKNOWN")
            if machine_id not in machines_with_alerts:
                machines_with_alerts[machine_id] = alert
        
        # Create inline buttons for each machine
        keyboard = []
        for machine_id in sorted(machines_with_alerts.keys()):
            alert = machines_with_alerts[machine_id]
            risk_score = alert.get("risk_score", 0)
            priority = alert.get("priority", "unknown").upper()
            
            emoji = "🔴" if priority == "CRITICAL" else "🟠" if priority == "HIGH" else "🟡"
            button_text = f"{emoji} {machine_id} ({risk_score})"
            
            keyboard.append([
                InlineKeyboardButton(button_text, callback_data=f"machine_{machine_id}")
            ])
        
        reply_markup = InlineKeyboardMarkup(keyboard)
        await update.message.reply_text(
            "Click any machine to view detailed report:",
            reply_markup=reply_markup
        )
        
    except Exception as e:
        print(f"[BOT] Error in status command: {e}")
        await update.message.reply_text(
            f"⚠️ Error fetching status: {str(e)}\n\n"
            "Make sure the backend is running at http://localhost:8000\n\n"
            "Run in another terminal:\npython run.py"
        )

async def machines_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show list of all monitored machines"""
    try:
        priority_queue = await fetch_priority_queue()
        
        # Get unique machine IDs from priority queue and a default list
        machine_ids = set(item.get("machine_id") for item in priority_queue)
        if not machine_ids:
            machine_ids = {"CNC_01", "CNC_02", "PUMP_03", "CONVEYOR_04"}
        
        message = "🏭 Monitored Machines\n\n"
        for mid in sorted(machine_ids):
            message += f"• {mid}\n"
        
        message += "\nUse /status to view alerts for these machines."
        
        await update.message.reply_text(message)
    except Exception as e:
        print(f"[BOT] Error in machines command: {e}")
        await update.message.reply_text("Error fetching machine list.")

async def handle_machine_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle inline button clicks for machine selection"""
    query = update.callback_query
    await query.answer()
    
    machine_id = query.data.replace("machine_", "")
    
    try:
        # Fetch all alerts
        alerts = await fetch_alerts()
        
        # Find alerts for the selected machine
        machine_alerts = [a for a in alerts if a.get("machine_id") == machine_id]
        
        if not machine_alerts:
            await query.edit_message_text(
                f"ℹ️ No alerts found for {machine_id}"
            )
            return
        
        # Display the most recent alert
        alert = machine_alerts[0]
        message = format_alert_message(alert)
        
        # Add additional details if available
        llm_reasoning = alert.get("llm_reasoning", "")
        if llm_reasoning:
            # Clean up the reasoning text
            reasoning_clean = llm_reasoning.replace('<', '').replace('>', '').replace('**', '').strip()
            
            # Limit to 1000 characters to avoid Telegram message length issues
            if len(reasoning_clean) > 1000:
                reasoning_display = reasoning_clean[:1000].rsplit(' ', 1)[0] + "..."
            else:
                reasoning_display = reasoning_clean
            
            message += f"\n\n💡 DETAILED ANALYSIS:\n{reasoning_display}"
        
        # Create back button
        keyboard = [[InlineKeyboardButton("← Back to Status", callback_data="back_to_status")]]
        reply_markup = InlineKeyboardMarkup(keyboard)
        
        await query.edit_message_text(
            message,
            reply_markup=reply_markup
        )
        
    except Exception as e:
        print(f"[BOT] Error handling machine selection: {e}")
        await query.edit_message_text(f"Error: {str(e)}")

async def handle_back_to_status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle back button to return to status view"""
    query = update.callback_query
    await query.answer()
    
    try:
        alerts = await fetch_alerts()
        priority_queue = await fetch_priority_queue()
        
        if not alerts:
            await query.edit_message_text("✅ All systems operational!")
            return
        
        # Recreate machine selection buttons
        machines_with_alerts = {}
        for alert in alerts[:20]:
            machine_id = alert.get("machine_id", "UNKNOWN")
            if machine_id not in machines_with_alerts:
                machines_with_alerts[machine_id] = alert
        
        keyboard = []
        for machine_id in sorted(machines_with_alerts.keys()):
            alert = machines_with_alerts[machine_id]
            risk_score = alert.get("risk_score", 0)
            priority = alert.get("priority", "unknown").upper()
            
            emoji = "🔴" if priority == "CRITICAL" else "🟠" if priority == "HIGH" else "🟡"
            button_text = f"{emoji} {machine_id} ({risk_score})"
            
            keyboard.append([
                InlineKeyboardButton(button_text, callback_data=f"machine_{machine_id}")
            ])
        
        reply_markup = InlineKeyboardMarkup(keyboard)
        await query.edit_message_text(
            "🚨 CRITICAL ALERTS DETECTED\n"
            "\n\n"
            "Click any machine to view detailed report:",
            reply_markup=reply_markup
        )
        
    except Exception as e:
        print(f"[BOT] Error handling back to status: {e}")

# ─── Main Application Setup ────────────────────────────────────────────────────

app = ApplicationBuilder().token(TOKEN).build()

# Add command handlers
app.add_handler(CommandHandler("start", start))
app.add_handler(CommandHandler("help", help_command))
app.add_handler(CommandHandler("status", status_command))
app.add_handler(CommandHandler("machines", machines_command))

# Add callback query handler for inline buttons
app.add_handler(CallbackQueryHandler(handle_machine_selection, pattern="^machine_"))
app.add_handler(CallbackQueryHandler(handle_back_to_status, pattern="^back_to_status$"))

print("[BOT] ForgeSight Telegram Bot is starting...")
print("[BOT] Available commands: /start, /status, /machines, /help")
app.run_polling()
