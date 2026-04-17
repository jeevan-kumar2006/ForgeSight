from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


class MachineStatus(str, Enum):
    RUNNING = "running"
    WARNING = "warning"
    FAULT = "fault"


class SensorReading(BaseModel):
    machine_id: str
    timestamp: datetime
    temperature_C: float
    vibration_mm_s: float
    rpm: float
    current_A: float
    status: MachineStatus


class SensorBaseline(BaseModel):
    mean: float
    std: float
    lower: float
    upper: float
    q1: float
    q3: float
    iqr: float


class MachineBaseline(BaseModel):
    machine_id: str
    temperature_C: SensorBaseline
    vibration_mm_s: SensorBaseline
    rpm: SensorBaseline
    current_A: SensorBaseline


class MaintenanceAlert(BaseModel):
    alert_id: str
    machine_id: str
    risk_score: float
    priority: str
    reason_summary: str
    llm_reasoning: str
    sensors_affected: List[str]
    is_llm: bool = False
    anomaly_type: str = "none"
    timestamp: datetime
    # Enhanced AI reasoning fields
    root_cause_prediction: Optional[str] = None
    suggested_fix: Optional[str] = None
    time_to_failure_hours: Optional[float] = None
    confidence_score: Optional[float] = None
    similar_patterns_count: Optional[int] = None
    detailed_analysis: Optional[str] = None


class MaintenanceSlot(BaseModel):
    slot_id: str
    machine_id: str
    scheduled_time: datetime
    reason: str
    priority: str
    created_at: datetime


class PriorityItem(BaseModel):
    machine_id: str
    risk_score: float
    priority: str
    reason: str
    since: datetime


class NoiseFilterData(BaseModel):
    raw_value: float
    filtered_value: float
    ai_interpreted_value: float
    was_spike_suppressed: bool = False
    confidence: float = 0.0


class AgentReadingEvent(BaseModel):
    machine_id: str
    timestamp: datetime
    temperature_C: float
    vibration_mm_s: float
    rpm: float
    current_A: float
    status: MachineStatus
    risk_score: float
    baselines: Dict[str, Dict[str, float]]
    active_anomalies: Dict[str, Any]
    data_gap: bool
    anomaly_type: str = "none"
    suppressed_spikes: int = 0
    # Enhanced noise filtering data
    noise_filter_data: Dict[str, NoiseFilterData] = {}
