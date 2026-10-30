import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { callFhirApi, buildUrl, maybeDecrypt } from '../services/fhir'
import { callAI } from '../services/agentChat'
import { FHIR_BASE } from '../config/constants'
import { formatDisplayName } from '../utils'
import { Line } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js'
import '../dashboard.css'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

const ALERT_ICONS = { 'Clinical Deterioration': '⚠', 'Medication Non-Adherence': 'pill-img', 'Missed Follow-Up Appointments': 'calendar-img' }

function summarizeFhirData(observations, encounters, medications, conditions) {
  const obs = (observations?.entry || []).slice(0, 60).map(e => {
    const r = e.resource
    return {
      code: r.code?.coding?.[0]?.display || r.code?.text || '',
      value: r.valueQuantity ? `${r.valueQuantity.value} ${r.valueQuantity.unit || ''}` : r.valueString || '',
      date: r.effectiveDateTime || r.issued || '',
      ref: r.referenceRange?.[0]?.text || ''
    }
  }).filter(o => o.code && o.value)

  const enc = (encounters?.entry || []).slice(0, 50).map(e => {
    const r = e.resource
    const locs = (r.location || []).map(l => ({
      name: l.location?.display || '',
      status: l.status || ''
    }))
    return {
      type: r.type?.[0]?.coding?.[0]?.display || r.type?.[0]?.text || '',
      status: r.status || '',
      class: r.class?.display || r.class?.code || '',
      priority: r.priority?.coding?.[0]?.display || '',
      date: r.period?.start || '',
      locations: locs,
      reason: r.reasonCode?.[0]?.coding?.[0]?.display || r.reasonCode?.[0]?.text || ''
    }
  })

  const med = (medications?.entry || []).slice(0, 40).map(e => {
    const r = e.resource
    return {
      name: r.medicationCodeableConcept?.coding?.[0]?.display || r.medicationCodeableConcept?.text || '',
      status: r.status || '',
      authored: r.authoredOn || '',
      note: r.note?.[0]?.text || ''
    }
  }).filter(m => m.name)

  const cond = (conditions?.entry || []).slice(0, 40).map(e => {
    const r = e.resource
    return {
      code: r.code?.coding?.[0]?.display || r.code?.text || '',
      status: r.clinicalStatus?.coding?.[0]?.code || '',
      severity: r.severity?.coding?.[0]?.display || '',
      onset: r.onsetDateTime || '',
      recorded: r.recordedDate || ''
    }
  }).filter(c => c.code)

  return { observations: obs, encounters: enc, medications: med, conditions: cond }
}

async function callAIForAnalysis(inputText) {
  const systemPrompt = `You are a clinical AI analyst. You will receive a care gap analysis text from a chatbot. Extract and structure the information into JSON.

Return ONLY valid JSON (no markdown fences, no explanation). Use this exact structure:
{
  "alerts": [
    { "title": "Clinical Deterioration", "detail": "one-line: most concerning clinical finding with specific value/condition name", "severity": "CRITICAL|HIGH|MEDIUM" },
    { "title": "Medication Non-Adherence", "detail": "one-line: worst medication gap with drug name and gap duration", "severity": "CRITICAL|HIGH|MEDIUM" },
    { "title": "Missed Follow-Up Appointments", "detail": "one-line: latest missed appointment with clinic name and date", "severity": "CRITICAL|HIGH|MEDIUM" }
  ],
  "trends": [
    { "label": "SHORT_LABEL", "value": "specific value or trend with units", "status": "critical|high|medium" }
  ],
  "aiActions": [
    { "title": "action title", "priority": "High Priority|Medium Priority|Low Priority", "timeframe": "Within 24 hours|Within 48 hours|Within 1 week|During next contact", "description": "what to do", "rationale": "why AI recommends this" }
  ],
  "missedAppointments": [
    { "title": "visit type/reason", "date": "exact date mentioned", "location": "clinic/location if mentioned", "reason": "reason for no-show or cancellation if mentioned" }
  ]
}

Rules:
- alerts: ALWAYS return exactly 3 in this order. Extract from the text:
  * Clinical Deterioration: emergencies, worsening conditions, abnormal labs. Be specific with condition names and values.
  * Medication Non-Adherence: self-discontinued meds, gaps, on-hold medications. Include drug name and gap duration.
  * Missed Follow-Up: no-show appointments, missed clinics. Include clinic name and date.
- severity: CRITICAL = life-threatening/recurring emergencies, HIGH = significant concern, MEDIUM = moderate, NONE = no issue found for this category
- detail: specific values, dates, drug names. Max 90 chars. If no issue exists for a category, set severity to "NONE" and detail to "No care gaps detected".
- trends: Extract ALL abnormal/deteriorating observations and clinical findings. SKIP any values that are normal. For each trend include:
  * The actual numeric value(s) with units. If multiple readings exist over time, show the trend with "→" (e.g. "7.2% → 11.8%").
  * Classify each as "critical" (dangerously abnormal), "high" (significantly abnormal), or "medium" (mildly abnormal).
  * Lab values: HBA1C, GLUCOSE, CREATININE, LDL, TRIGLYCERIDES, CRP, ACR, ALBUMIN, etc. Show value + (Normal: X) + status e.g. "11.8% (Normal: <5.6%) ↑ HIGH"
  * Clinical conditions: DKA EPISODES, NEPHROPATHY, FOOT ULCER, SEPSIS, NEUROPATHY etc. Show severity/frequency.
  * Be thorough - include EVERY abnormal observation and deteriorating condition mentioned. Do NOT skip any.
  * Label must be uppercase short name. Aim for 5-10+ trends if the data supports it.
- aiActions: Generate 4-6 recommended actions based on the care gaps. Each must have:
  * title: specific actionable task (e.g. "Urgent Patient Outreach - Phone Call", "Medication Reconciliation", "Reschedule Cardiology Appointment", "Provider Alert", "Send Educational Materials", "Social Determinants Screening")
  * priority: "High Priority", "Medium Priority", or "Low Priority" based on urgency
  * timeframe: "Within 24 hours", "Within 48 hours", "Within 1 week", or "During next contact"
  * description: 1-2 sentences on what to do
  * rationale: 1-2 sentences on why AI recommends this, referencing specific care gap findings
- missedAppointments: Extract ALL missed follow-ups, no-shows, and cancelled appointments from the care gap text. For each include:
  * title: visit type or reason (e.g. "Endocrinology Follow-Up", "Diabetic Foot Screening", "Lab Work")
  * date: the exact date mentioned (e.g. "Nov 10, 2024", "Mar 13, 2026")
  * location: clinic or location name if mentioned, otherwise ""
  * reason: reason for no-show/cancellation if mentioned, otherwise ""
  * Include EVERY missed/cancelled appointment mentioned. Do NOT skip any.`

  const text = await callAI(systemPrompt, inputText, { temperature: 0.2, maxTokens: 3500 })

  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }
  return JSON.parse(cleaned)
}

function parseMedsFromFhir(bundle) {
  if (!bundle?.entry?.length) return null
  const meds = []
  for (const e of bundle.entry) {
    const r = e.resource
    if (r.resourceType !== 'MedicationRequest') continue
    const name = r.medicationCodeableConcept?.coding?.[0]?.display
      || r.medicationCodeableConcept?.text || ''
    if (!name) continue
    const dosage = r.dosageInstruction?.[0] || {}
    const dose = dosage.doseAndRate?.[0]?.doseQuantity
      ? `${dosage.doseAndRate[0].doseQuantity.value}${dosage.doseAndRate[0].doseQuantity.unit || 'mg'}`
      : dosage.text || ''
    const freq = dosage.timing?.code?.text
      || dosage.timing?.repeat?.frequency
        ? `${dosage.timing?.repeat?.frequency}x/${dosage.timing?.repeat?.period || ''} ${dosage.timing?.repeat?.periodUnit || ''}`.trim()
        : ''
    const status = r.status
      ? r.status.charAt(0).toUpperCase() + r.status.slice(1).replace(/-/g, ' ')
      : 'Active'
    const note = r.note?.[0]?.text || ''
    const authored = r.authoredOn || ''
    meds.push({ name, dose, frequency: freq || dose, status, note, authored })
  }
  meds.sort((a, b) => (b.authored || '').localeCompare(a.authored || ''))
  return meds.length ? meds : null
}

function parseEncountersFromFhir(bundle) {
  if (!bundle?.entry?.length) return null
  const encounters = []
  for (const e of bundle.entry) {
    const r = e.resource
    if (r.resourceType !== 'Encounter') continue
    const type = r.type?.[0]?.coding?.[0]?.display || r.type?.[0]?.text || 'Encounter'
    const status = r.status || ''
    const cls = r.class?.display || r.class?.code || ''
    const startDate = r.period?.start || ''
    const endDate = r.period?.end || ''
    const locations = (r.location || []).map(l => l.location?.display || '').filter(Boolean)
    const reason = r.reasonCode?.[0]?.coding?.[0]?.display || r.reasonCode?.[0]?.text || ''
    const isNoShow = locations.some(l => l.toUpperCase().includes('NO SHOW') || l.toUpperCase().includes('N/A'))
    const isCancelled = status === 'cancelled'
    const isMissed = isNoShow || isCancelled

    let dateStr = ''
    let timeStr = ''
    if (startDate) {
      const d = new Date(startDate)
      if (!isNaN(d)) {
        dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      }
    }
    let endDateStr = ''
    let endTimeStr = ''
    if (endDate) {
      const ed = new Date(endDate)
      if (!isNaN(ed)) {
        endDateStr = ed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        endTimeStr = ed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      }
    }

    let apptStatus = 'completed'
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const apptDate = startDate ? new Date(startDate) : null
    if (isMissed) apptStatus = 'missed'
    else if (status === 'stopped' || status === 'entered-in-error') apptStatus = 'stopped'
    else if (apptDate && apptDate > today) apptStatus = 'upcoming'

    encounters.push({
      title: type || reason || 'Appointment',
      status: apptStatus,
      with: reason || cls || type,
      date: dateStr,
      time: timeStr,
      endDate: endDateStr,
      endTime: endTimeStr,
      location: locations.join(', ') || '',
      isMissed,
      rawDate: startDate
    })
  }
  encounters.sort((a, b) => (b.rawDate || '').localeCompare(a.rawDate || ''))
  return encounters.length ? encounters : null
}

function parseAppointmentsFromFhir(bundle) {
  if (!bundle?.entry?.length) return null
  const appts = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (const e of bundle.entry) {
    const r = e.resource
    if (r.resourceType !== 'Appointment') continue
    const desc = r.description || r.serviceType?.[0]?.text || r.serviceType?.[0]?.coding?.[0]?.display || 'Appointment'
    const rawStatus = r.status || ''
    const startStr = r.start || ''
    const endStr = r.end || ''
    const reason = r.reasonCode?.[0]?.text || r.reasonCode?.[0]?.coding?.[0]?.display || ''
    const location = r.extension?.find(ext => ext.url === 'Location')?.valueString || ''
    const serviceType = r.serviceType?.[0]?.text || r.serviceType?.[0]?.coding?.[0]?.display || ''

    let dateStr = '', timeStr = ''
    if (startStr) {
      const d = new Date(startStr)
      if (!isNaN(d)) {
        dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      }
    }
    let endDateStr = '', endTimeStr = ''
    if (endStr) {
      const ed = new Date(endStr)
      if (!isNaN(ed)) {
        endDateStr = ed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        endTimeStr = ed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      }
    }

    let apptStatus = 'completed'
    const apptDate = startStr ? new Date(startStr) : null
    if (rawStatus === 'noshow') apptStatus = 'missed'
    else if (rawStatus === 'cancelled') apptStatus = 'stopped'
    else if (rawStatus === 'booked' || rawStatus === 'pending' || rawStatus === 'proposed') {
      apptStatus = apptDate && apptDate >= today ? 'upcoming' : 'completed'
    } else if (rawStatus === 'fulfilled' || rawStatus === 'arrived' || rawStatus === 'checked-in') {
      apptStatus = 'completed'
    }

    appts.push({
      title: desc,
      status: apptStatus,
      with: reason || serviceType || '',
      date: dateStr,
      time: timeStr,
      endDate: endDateStr,
      endTime: endTimeStr,
      location: location || '',
      isMissed: apptStatus === 'missed',
      rawDate: startStr
    })
  }
  appts.sort((a, b) => {
    const order = { upcoming: 0, missed: 1, completed: 2, stopped: 3 }
    const oa = order[a.status] ?? 9, ob = order[b.status] ?? 9
    if (oa !== ob) return oa - ob
    return (b.rawDate || '').localeCompare(a.rawDate || '')
  })
  return appts.length ? appts : null
}

async function parseCareTeamFromEoC(bundle) {
  if (!bundle?.entry?.length) return null
  const team = []
  const practIdMap = {}
  for (const e of bundle.entry) {
    const r = e.resource
    if (r.resourceType !== 'EpisodeOfCare') continue
    const careManager = r.careManager
    if (!careManager) continue
    const name = careManager.display || 'Care Manager'
    const initials = name.split(' ').filter(w => w.length > 0).map(w => w[0]).join('').toUpperCase().slice(0, 2)
    const program = r.type?.[0]?.coding?.[0]?.display || r.type?.[0]?.text || 'Care Program'
    const status = r.status || 'active'
    const periodStart = r.period?.start || ''
    const practId = careManager.reference?.replace('Practitioner/', '') || ''
    if (!team.some(t => t.name === name)) {
      team.push({ name, initials, role: 'Care Coordinator', program, status, periodStart, email: '', practId })
      if (practId) practIdMap[practId] = null
    }
  }
  await Promise.all(Object.keys(practIdMap).map(async (id) => {
    try {
      const res = await callFhirApi(`${FHIR_BASE}/baseR4/Practitioner?_id=${id}&page=0&size=1`)
      const pr = res?.entry?.[0]?.resource
      if (pr) {
        const email = pr.telecom?.find(t => t.system === 'email')?.value || ''
        practIdMap[id] = { email }
      }
    } catch (_) {}
  }))
  for (const member of team) {
    if (member.practId && practIdMap[member.practId]) {
      member.email = practIdMap[member.practId].email || ''
    }
  }
  return team.length ? team : null
}

const RISK_LABEL_MAP = { cvd: 'Hypertension', diabetes: 'Diabetes', cancer: 'Cancer' }
const RISK_ICON_MAP = {
  cvd: 'https://fhirassist.rsystems.com:5050/src/tileIcons/hipertension.svg',
  diabetes: 'https://fhirassist.rsystems.com:5050/src/tileIcons/diabteis.svg',
  cancer: 'https://fhirassist.rsystems.com:5050/src/tileIcons/cancer.svg',
}

async function fetchRiskPrediction(patientId) {
  try {
    const token = localStorage.getItem('cb_token')
    const res = await fetch(`https://fhirassist.rsystems.com:8081/api/v1/predict/risk-insights?patient_id=${patientId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    const html = await res.text()
    const startIdx = html.indexOf('var D=')
    if (startIdx === -1) return null
    const jsonStart = html.indexOf('{', startIdx)
    let depth = 0, end = jsonStart
    for (let i = jsonStart; i < html.length; i++) {
      if (html[i] === '{') depth++
      else if (html[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    const data = JSON.parse(html.slice(jsonStart, end + 1))
    const risks = []
    for (const [key, val] of Object.entries(data)) {
      const level = (val.risk_level || 'low').toLowerCase()
      const riskObj = {
        key,
        name: RISK_LABEL_MAP[key] || key.toUpperCase(),
        icon: RISK_ICON_MAP[key] || '',
        value: val.risk_percentage != null ? val.risk_percentage.toFixed(1) + '%' : '—',
        percentage: val.risk_percentage || 0,
        level: level === 'moderate' ? 'mod' : level,
        levelLabel: val.risk_level || 'Low',
        drivers: val.risk_drivers || [],
        protective: val.protective_factors || [],
      }
      risks.push(riskObj)
    }
    return risks.length ? risks : null
  } catch (e) {
    console.warn('[Dashboard] Risk prediction fetch failed:', e)
    return null
  }
}

const OBSERVATION_NORMAL_RANGES = {
  '4548-4':  { name: 'HEMOGLOBIN A1C', unit: '%', low: 4.0, high: 5.6, normal: '4.0-5.6' },
  '2160-0':  { name: 'CREATININE', unit: 'mg/dL', low: 0.6, high: 1.3, normal: '0.6-1.3' },
  '2345-7':  { name: 'GLUCOSE', unit: 'mg/dL', low: 70, high: 99, normal: '70-99' },
  '2823-3':  { name: 'POTASSIUM', unit: 'mEq/L', low: 3.5, high: 5.0, normal: '3.5-5.0' },
  '1644-4':  { name: 'TRIGLYCERIDES', unit: 'mg/dL', low: 0, high: 150, normal: '<150' },
  '2090-9':  { name: 'CHOLESTEROL LDL', unit: 'mg/dL', low: 0, high: 130, normal: '<130' },
  '2093-3':  { name: 'CHOLESTEROL TOTAL', unit: 'mg/dL', low: 125, high: 200, normal: '125-200' },
  '718-7':   { name: 'HEMOGLOBIN', unit: 'g/dL', low: 13.0, high: 17.5, normal: '13.0-17.5' },
  '785-6':   { name: 'WBC', unit: '10*3/uL', low: 4.5, high: 11.0, normal: '4.5-11.0' },
  '777-3':   { name: 'PLATELETS', unit: '10*3/uL', low: 150, high: 400, normal: '150-400' },
  '8867-4':  { name: 'HEART RATE', unit: 'bpm', low: 60, high: 100, normal: '60-100' },
  '8480-6':  { name: 'SYSTOLIC BP', unit: 'mmHg', low: 90, high: 120, normal: '<120' },
  '8462-4':  { name: 'DIASTOLIC BP', unit: 'mmHg', low: 60, high: 80, normal: '<80' },
  '8310-5':  { name: 'BODY TEMPERATURE', unit: '°F', low: 97.8, high: 99.1, normal: '97.8-99.1' },
  '59408-5': { name: 'OXYGEN SATURATION (SpO2)', unit: '%', low: 95, high: 100, normal: '95-100' },
  '33762-6': { name: 'NT-proBNP', unit: 'pg/mL', low: 0, high: 125, normal: '<125' },
  '2951-2':  { name: 'SODIUM', unit: 'mEq/L', low: 136, high: 145, normal: '136-145' },
}

const ALL_OBS_GROUPS = [
  { key: 'bp', label: 'BP', codes: ['8480-6', '8462-4'], colors: ['#EF4444', '#3B82F6'], targets: [120, 80], targetLabels: ['Systolic (Target: 120)', 'Diastolic (Target: 80)'] },
  { key: 'glucose', label: 'Glucose', codes: ['2345-7'], colors: ['#8B5CF6'], targets: [130], targetLabels: ['Target Range: 70-130 mg/dL'], fill: true },
  { key: 'heartrate', label: 'Heart Rate', codes: ['8867-4'], colors: ['#F59E0B'], targets: null, targetLabels: ['Normal Range: 60-100 bpm'] },
  { key: 'hba1c', label: 'HbA1c', codes: ['4548-4'], colors: ['#22C55E'], targets: [7.0], targetLabels: ['Target: < 7.0%'] },
  { key: 'creatinine', label: 'Creatinine', codes: ['2160-0'], colors: ['#EF4444'], targets: [1.3], targetLabels: ['Upper Limit: 1.3 mg/dL'] },
  { key: 'ntprobnp', label: 'NT-proBNP', codes: ['33762-6'], colors: ['#EC4899'], targets: [125], targetLabels: ['Upper Limit: 125 pg/mL'] },
  { key: 'potassium', label: 'Potassium', codes: ['2823-3'], colors: ['#F59E0B'], targets: null, targetLabels: ['Normal Range: 3.5-5.0 mEq/L'] },
  { key: 'ldl', label: 'LDL', codes: ['2090-9'], colors: ['#3B82F6'], targets: [100], targetLabels: ['Target: < 100 mg/dL'] },
  { key: 'cholesterol', label: 'Cholesterol', codes: ['2093-3'], colors: ['#6366F1'], targets: [200], targetLabels: ['Upper Limit: 200 mg/dL'] },
  { key: 'triglycerides', label: 'Triglycerides', codes: ['1644-4'], colors: ['#F97316'], targets: [150], targetLabels: ['Upper Limit: 150 mg/dL'] },
  { key: 'sodium', label: 'Sodium', codes: ['2951-2'], colors: ['#14B8A6'], targets: null, targetLabels: ['Normal Range: 136-145 mEq/L'] },
  { key: 'bodytemp', label: 'Body Temp', codes: ['8310-5'], colors: ['#EF4444'], targets: null, targetLabels: ['Normal Range: 36.1-37.2 °C'] },
  { key: 'hemoglobin', label: 'Hemoglobin', codes: ['718-7'], colors: ['#DC2626'], targets: null, targetLabels: ['Normal Range: 13.0-17.5 g/dL'] },
  { key: 'wbc', label: 'WBC', codes: ['785-6'], colors: ['#8B5CF6'], targets: null, targetLabels: ['Normal Range: 4.5-11.0 10*3/uL'] },
  { key: 'platelets', label: 'Platelets', codes: ['777-3'], colors: ['#F59E0B'], targets: null, targetLabels: ['Normal Range: 150-400 10*3/uL'] },
]

const LAB_COLORS = ['#3B82F6', '#22C55E', '#EF4444', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#6366F1']

function buildDynamicTrendTabs(obsData, deterioratingTrends) {
  if (!obsData) return []
  const detLabels = (deterioratingTrends || []).map(t => t.label.toUpperCase().replace(/\s+TREND$/, '').trim())
  const available = ALL_OBS_GROUPS
    .map(g => {
      const totalPoints = g.codes.reduce((sum, code) => sum + (obsData[code]?.points?.length || 0), 0)
      return { ...g, totalPoints }
    })
    .filter(g => {
      if (g.totalPoints === 0) return false
      if (!detLabels.length) return true
      const gLabel = g.label.toUpperCase()
      const gKey = g.key.toUpperCase()
      const gCodeNames = g.codes.map(c => (OBSERVATION_NORMAL_RANGES[c]?.name || '').toUpperCase())
      return detLabels.some(dl => gLabel.includes(dl) || dl.includes(gLabel) || gKey.includes(dl) || dl.includes(gKey) || gCodeNames.some(cn => cn.includes(dl) || dl.includes(cn)))
    })
    .sort((a, b) => b.totalPoints - a.totalPoints)
  return available
}

function parseAllObservationsForTrends(bundle) {
  if (!bundle?.entry?.length) return null
  const byCode = {}
  for (const e of bundle.entry) {
    const r = e.resource
    if (r.resourceType !== 'Observation') continue
    const code = r.code?.coding?.[0]?.code || ''
    const display = r.code?.coding?.[0]?.display || ''
    const value = r.valueQuantity?.value ?? parseFloat(r.valueString)
    const unit = r.valueQuantity?.unit || r.valueQuantity?.code || ''
    const date = r.effectiveDateTime || r.issued || ''
    if (!code || isNaN(value)) continue
    if (!byCode[code]) byCode[code] = { display, unit, points: [] }
    byCode[code].points.push({ date: new Date(date), value })
  }
  for (const c of Object.values(byCode)) {
    c.points.sort((a, b) => a.date - b.date)
  }
  return Object.keys(byCode).length ? byCode : null
}

function parseVitalsFromFhir(bundle) {
  if (!bundle?.entry?.length) return null
  const latestByCode = {}
  for (const e of bundle.entry) {
    const r = e.resource
    if (r.resourceType !== 'Observation') continue
    const code = r.code?.coding?.[0]?.code || ''
    const display = r.code?.coding?.[0]?.display || ''
    const value = r.valueQuantity?.value ?? r.valueString ?? ''
    const unit = r.valueQuantity?.unit || r.valueQuantity?.code || ''
    const date = r.effectiveDateTime || r.issued || ''
    if (!code || value === '') continue
    if (!latestByCode[code] || date > latestByCode[code].date) {
      latestByCode[code] = { code, display, value, unit, date }
    }
  }
  const vitals = []
  for (const [code, obs] of Object.entries(latestByCode)) {
    const range = OBSERVATION_NORMAL_RANGES[code]
    const name = range?.name || obs.display.toUpperCase()
    const unit = range?.unit || obs.unit
    const normal = range?.normal || '—'
    const numVal = parseFloat(obs.value)
    let status = 'normal'
    let pct = 50
    if (range && !isNaN(numVal)) {
      if (numVal < range.low) { status = 'low'; pct = 20 }
      else if (numVal > range.high) { status = 'elevated'; pct = 80 }
      else { pct = Math.round(((numVal - range.low) / (range.high - range.low)) * 60 + 20) }
    }
    const d = new Date(obs.date)
    const dateStr = !isNaN(d) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
    vitals.push({ name, value: String(obs.value), unit, normal, status, pct, date: dateStr })
  }
  return vitals.length ? vitals : null
}

function parsePatientFromResource(resource, patientId) {
  if (!resource) return null
  console.log('[Dashboard] FHIR Patient resource:', JSON.stringify(resource, null, 2))

  let name = 'Unknown'
  if (resource.name?.length) {
    const n = resource.name[0]
    if (n.text) {
      name = n.text
    } else {
      const given = n.given?.join(' ') || ''
      const family = n.family || ''
      name = [given, family].filter(Boolean).join(' ') || name
    }
  }
  const nameParts = name.split(' ').filter(Boolean)
  if (nameParts.length > 2) {
    name = nameParts[0] + ' ' + nameParts[nameParts.length - 1]
  }
  const initials = name !== 'Unknown'
    ? name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : 'U'

  const gender = resource.gender
    ? resource.gender.charAt(0).toUpperCase() + resource.gender.slice(1)
    : '—'

  let phone = '—', email = '—'
  const telecoms = resource.telecom || []
  for (const t of telecoms) {
    if (t.system === 'phone' && phone === '—') {
      const digits = (t.value || '').replace(/\D/g, '')
      const d = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits
      phone = d.length === 10 ? `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}` : t.value
    }
    if (t.system === 'email' && email === '—') email = t.value
  }

  let age = '—', dob = '—'
  const birthDate = resource.birthDate || ''
  if (birthDate) {
    const parts = birthDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (parts) {
      const bDate = new Date(+parts[1], +parts[2] - 1, +parts[3])
      const now = new Date()
      age = now.getFullYear() - bDate.getFullYear()
      if (now.getMonth() < bDate.getMonth() ||
          (now.getMonth() === bDate.getMonth() && now.getDate() < bDate.getDate())) {
        age--
      }
      dob = bDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    }
  }

  let mrn = patientId
  const identifiers = resource.identifier || []
  for (const ident of identifiers) {
    const typeCode = ident.type?.coding?.[0]?.code
    if (typeCode === 'MR' || ident.system?.includes('mrn')) {
      const raw = ident.value || mrn
      mrn = raw.replace(/^MRN-/i, '')
      break
    }
  }

  return { name, initials, age, gender, dob, phone, email, mrn }
}

const MOCK_DATA = {
  patient: {
    name: 'Sarah Johnson', initials: 'SJ', age: 67, gender: 'Female',
    mrn: 'MRN-789456123', programs: ['Diabetes', 'Hypertension'],
    ascvdScore: '32%', priority: 'High Priority', hasCareGap: true,
    dob: 'May 15, 1957', phone: '(555) 123-4567', email: 'sarahjohnson@email.com'
  },
  alerts: [
    { title: 'Uncontrolled Hypertension', detail: 'Latest: 165/105 mmHg', severity: 'critical', icon: '⚠' },
    { title: 'Medication Non-Adherence', detail: '45 day gap in Lisinopril', severity: 'high', icon: '💊' },
    { title: 'Missed Appointments', detail: 'Cardiology (Feb 10)', severity: 'medium', icon: '📅' }
  ],
  trends: { bp: '+17 mmHg (6w)', hba1c: '8.6% (Target <7)', ldl: '172 mg/dL' },
  riskInsights: [
    { name: 'HYPERTENSION', value: '32.6%', level: 'mod' },
    { name: 'DIABETES', value: '2.5%', level: 'low' },
    { name: 'CANCER', value: '5.2%', level: 'low' }
  ],
  careTeam: [
    { name: 'Dr. Michael Chen', initials: 'DMC', role: 'Primary Care Physician', dept: 'Internal Medicine', primary: true },
    { name: 'Emily Davis', initials: 'ED', role: 'Nurse Practitioner', dept: 'Family Medicine' },
    { name: 'Jane Smith', initials: 'JS', role: 'Care Coordinator', dept: '' },
    { name: 'Dr. Robert Williams', initials: 'DRW', role: 'Endocrinologist', dept: 'Diabetes Management' }
  ],
  aiActions: [
    { title: 'Urgent Patient Outreach - Phone Call', priority: 'High Priority', priorityClass: 'high', timeframe: 'Within 24 hours',
      description: 'Contact patient within 24 hours to discuss medication adherence and appointment no-shows',
      rationale: 'Multiple care gaps detected including 45-day medication gap and missed cardiology appointment' },
    { title: 'Medication Reconciliation', priority: 'High Priority', priorityClass: 'high', timeframe: 'Within 48 hours',
      description: 'Review current medications, identify barriers to adherence, discuss pharmacy access',
      rationale: 'Lisinopril and Metformin gaps exceed 30 days, contributing to deteriorating vitals' },
    { title: 'Reschedule Cardiology Appointment', priority: 'Medium Priority', priorityClass: 'medium', timeframe: 'Within 1 week',
      description: 'Schedule follow-up cardiology appointment and address barriers to attendance',
      rationale: 'Missed appointment on Feb 10, 2026. Critical for managing uncontrolled hypertension.' },
    { title: 'Send Educational Materials', priority: 'Medium Priority', priorityClass: 'medium', timeframe: 'Within 48 hours',
      description: 'Share diabetes and hypertension management resources via patient portal',
      rationale: 'Patient education may improve understanding of medication importance and self management' },
    { title: 'Provider Alert', priority: 'High Priority', priorityClass: 'high', timeframe: 'Within 24 hours',
      description: 'Notify PCP of deteriorating BP trends and medication non-adherence via secure message',
      rationale: 'Provider may need to adjust treatment plan given worsening clinical indicators' },
    { title: 'Social Determinants Screening', priority: 'Low Priority', priorityClass: 'low', timeframe: 'During next contact',
      description: 'Assess financial, transportation, and social barriers affecting care engagement',
      rationale: 'Multiple missed appointments and medication gaps suggest potential social barriers' }
  ],
  clinicalNotes: [
    { author: 'Dr. Michael Chen', initials: 'DMC', role: 'Primary Care Physician', type: 'Clinical',
      text: 'Patient reports improved energy levels since starting new medication regimen. Blood pressure slightly elevated, will monitor closely. Discussed importance of dietary modifications and regular exercise.',
      date: 'Jan 28, 2026 · 2:15 PM' },
    { author: 'Jane Smith, RN', initials: 'JS', role: 'Care Coordinator', type: 'Coordination',
      text: 'Coordinated with patient\'s pharmacy to set up automatic prescription refills. Scheduled follow-up appointment for February. Patient expressed concerns about transportation to appointments - referred to community transport services.',
      date: 'Jan 27, 2026 · 11:30 AM' },
    { author: 'Emily Davis, NP', initials: 'ED', role: 'Nurse Practitioner', type: 'Clinical',
      text: 'Completed telehealth check-in. Patient demonstrates good understanding of medication schedule. Blood glucose logs show improvement over past two weeks. Encouraged to continue current care plan.',
      date: 'Jan 25, 2026 · 9:45 AM' }
  ],
  vitals: [
    { name: 'BLOOD PRESSURE', value: '142/88', unit: 'mmHg', normal: '120/80', status: 'elevated', pct: 78 },
    { name: 'HEART RATE', value: '78', unit: 'bpm', normal: '60-100', status: 'normal', pct: 45 },
    { name: 'BLOOD GLUCOSE', value: '145', unit: 'mg/dl', normal: '70-130', status: 'elevated', pct: 82 },
    { name: 'TEMPERATURE', value: '98.6', unit: '°F', normal: '97-99', status: 'normal', pct: 50 }
  ],
  medications: [
    { name: 'Metformin', dose: '500mg', frequency: 'Twice daily with meals', doctor: 'Dr. Michael Chen', started: 'Jan 15, 2024' },
    { name: 'Lisinopril', dose: '10mg', frequency: 'Once daily in the morning', doctor: 'Dr. Michael Chen', started: 'Dec 1, 2023' },
    { name: 'Atorvastatin', dose: '20mg', frequency: 'Once daily at bedtime', doctor: 'Dr. Michael Chen', started: 'Nov 10, 2023' }
  ],
  appointments: [
    { title: 'Follow-up Consultation', status: 'upcoming', with: 'Dr. Michael Chen', date: 'Feb 5, 2026', time: '10:00 AM', location: 'Main Clinic - Room 203' },
    { title: 'Telehealth Check-in', status: 'upcoming', telehealth: true, with: 'Nurse Practitioner Emily Davis', date: 'Feb 12, 2026', time: '2:30 PM', location: '' },
    { title: 'Lab Work', status: 'completed', with: 'Quest Diagnostics', date: 'Jan 25, 2026', time: '9:00 AM', location: 'Lab Center - Building B' }
  ]
}

const VITAL_ICONS = {
  'BLOOD PRESSURE': <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>,
  'HEART RATE': <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
  'BLOOD GLUCOSE': <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>,
  'TEMPERATURE': <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>
}

async function parseClinicalNotesFromEncounters(encBundle, careManagerIds) {
  if (!encBundle?.entry?.length) return null
  const practitionerMap = {}
  const notesByPractitioner = {}

  for (const e of encBundle.entry) {
    const r = e.resource
    if (!r) continue
    const noteExt = r.extension?.find(x => x.url === 'clinicalNotes')
    if (!noteExt?.valueString) continue
    const practRef = r.participant?.[0]?.individual?.reference
    if (!practRef) continue
    const practId = practRef.replace('Practitioner/', '')
    const date = r.period?.start
    if (!notesByPractitioner[practId] || new Date(date) > new Date(notesByPractitioner[practId].date)) {
      notesByPractitioner[practId] = { text: noteExt.valueString, date, encClass: r.class?.code }
    }
    if (!practitionerMap[practId]) practitionerMap[practId] = null
  }

  const practIds = Object.keys(practitionerMap)
  await Promise.all(practIds.map(async (id) => {
    try {
      const res = await callFhirApi(`${FHIR_BASE}/baseR4/Practitioner?_id=${id}&page=0&size=1`)
      const pr = res?.entry?.[0]?.resource
      if (pr) {
        const given = pr.name?.[0]?.given?.join(' ') || ''
        const family = pr.name?.[0]?.family || ''
        const prefix = pr.name?.[0]?.prefix?.join(' ') || ''
        const specialty = pr.qualification?.[0]?.code?.text || pr.qualification?.[0]?.code?.coding?.[0]?.display || ''
        practitionerMap[id] = { name: `${prefix} ${given} ${family}`.trim(), specialty }
      }
    } catch (_) {}
  }))

  const careManagerIdSet = new Set(careManagerIds || [])
  const notes = []
  for (const [practId, note] of Object.entries(notesByPractitioner)) {
    const pract = practitionerMap[practId] || { name: 'Unknown', specialty: '' }
    const isCareCoordinator = careManagerIdSet.has(practId) || /coordinator|care manager|nurse/i.test(pract.specialty)
    const nameParts = pract.name.replace(/^(Dr\.|Mr\.|Ms\.|Mrs\.)\s*/i, '').trim().split(/\s+/)
    const initials = nameParts.map(p => p[0]?.toUpperCase()).filter(Boolean).join('').slice(0, 3)
    const dt = new Date(note.date)
    const dateStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    notes.push({
      author: pract.name || 'Unknown',
      initials,
      role: isCareCoordinator ? 'Care Coordinator' : (pract.specialty || 'Physician'),
      type: isCareCoordinator ? 'Coordination' : 'Clinical',
      text: note.text,
      date: dateStr,
      rawDate: dt,
    })
  }
  notes.sort((a, b) => b.rawDate - a.rawDate)
  return notes
}

function LoadingScreen({ stepRef }) {
  const [step, setStep] = useState(0)
  const steps = ['Fetching Patient Data...', 'Analyzing Clinical Trends...', 'Generating AI Insights...']

  useEffect(() => {
    if (stepRef) stepRef.current = setStep
    const t1 = setTimeout(() => setStep(s => Math.max(s, 1)), 1200)
    const t2 = setTimeout(() => setStep(s => Math.max(s, 2)), 2200)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [stepRef])

  return (
    <div className="dash-loading">
      <div className="dash-loading-box">
        <img src="/images/Rsystems_Logo_White.png" alt="R Systems" className="dash-loading-logo" />
        <div className="dash-loading-spinner-ring"><div></div><div></div><div></div></div>
        <h2>Generating AI Insights...</h2>
        <p className="dash-loading-sub">Analyzing patient data and identifying care gaps</p>
        <div className="dash-loading-steps">
          {steps.map((s, i) => (
            <div key={i} className={`dash-loading-step ${i <= step ? 'active' : ''}`}>
              <span className="dash-step-dot">{i <= step ? '✓' : (i === step + 1 ? '●' : '○')}</span>
              {s}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function DashboardPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const dParam = searchParams.get('d')
  const [decodedPatientId, decodedEmail] = (() => {
    if (dParam) {
      try {
        const decoded = atob(dParam)
        const parts = decoded.split('|')
        return [parts[0] || '', parts[1] || '']
      } catch (_) { return ['', ''] }
    }
    return [searchParams.get('patient') || '', searchParams.get('email') || localStorage.getItem('cb_email') || '']
  })()
  const patientId = decodedPatientId
  const userEmail = decodedEmail
  const [isLoading, setIsLoading] = useState(true)
  const [aiLoading, setAiLoading] = useState(true)
  const [patient, setPatient] = useState(null)
  const [alertsData, setAlertsData] = useState(null)
  const [trendsData, setTrendsData] = useState(null)
  const [aiActionsData, setAiActionsData] = useState(null)
  const [medsData, setMedsData] = useState(null)
  const [encData, setEncData] = useState(null)
  const [apptData, setApptData] = useState(null)
  const [missedAppts, setMissedAppts] = useState(null)
  const [encApptTab, setEncApptTab] = useState('encounters')
  const [apptPageNum, setApptPageNum] = useState(1)
  const [careTeamData, setCareTeamData] = useState(null)
  const [vitalsData, setVitalsData] = useState(null)
  const [riskData, setRiskData] = useState(null)
  const [viewingRisk, setViewingRisk] = useState(null)
  const [showAllVitals, setShowAllVitals] = useState(false)
  const [medsPage, setMedsPage] = useState(1)
  const [apptsPage, setApptsPage] = useState(1)
  const [isReviewed, setIsReviewed] = useState(false)
  const [lastReviewDate, setLastReviewDate] = useState(null)
  const [selectedActions, setSelectedActions] = useState([])
  const [approvedActions, setApprovedActions] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [coordinatorNotes, setCoordinatorNotes] = useState('')
  const [approveAlert, setApproveAlert] = useState(false)
  const [taskAlert, setTaskAlert] = useState(null)
  const [noteFilter, setNoteFilter] = useState('clinical')
  const [notePage, setNotePage] = useState(1)
  const [activeTab, setActiveTab] = useState('actions')
  const [taskQueue, setTaskQueue] = useState([])
  const [taskFilter, setTaskFilter] = useState('pending')
  const [clinicalNotesData, setClinicalNotesData] = useState(null)
  const [clinicDocNotes, setClinicDocNotes] = useState(null)
  const [adminDocNotes, setAdminDocNotes] = useState(null)
  const [careDocNotes, setCareDocNotes] = useState(null)
  const [allObsData, setAllObsData] = useState(null)
  const [trendTab, setTrendTab] = useState(null)
  const [trendPeriod, setTrendPeriod] = useState('all')
  const [addedNotes, setAddedNotes] = useState([])
  const [showAddNoteModal, setShowAddNoteModal] = useState(false)
  const [newNote, setNewNote] = useState({ author: '', role: '', type: 'Clinical', text: '' })
  const [viewingNote, setViewingNote] = useState(null)
  const [taskNoteTexts, setTaskNoteTexts] = useState({})
  const [outreachMsg, setOutreachMsg] = useState('')
  const [outreachLoading, setOutreachLoading] = useState(false)
  const loadStepRef = useRef(null)

  const rawUser = localStorage.getItem('cb_user') || 'User'
  const userName = formatDisplayName(rawUser)

  useEffect(() => {
    if (!localStorage.getItem('cb_token')) { navigate('/'); return }

    const minLoadTime = new Promise(r => setTimeout(r, 2800))

    async function loadDashboard() {
      let patientName = 'Patient'

      const cached = sessionStorage.getItem('dashboard_patient_' + patientId)
      if (cached) {
        try {
          const resource = JSON.parse(cached)
          const parsed = parsePatientFromResource(resource, patientId)
          if (parsed) { setPatient(parsed); patientName = parsed.name }
        } catch (_) {}
      }
      if (!patient) {
        try {
          const directUrl = `${FHIR_BASE}/baseR4/Patient/${patientId}`
          const result = await callFhirApi(directUrl)
          let parsed = null
          if (result?.resourceType === 'Patient') parsed = parsePatientFromResource(result, patientId)
          else if (result?.entry?.length) parsed = parsePatientFromResource(result.entry[0].resource, patientId)
          if (parsed) { setPatient(parsed); patientName = parsed.name }
        } catch (_) {}
      }

      if (loadStepRef.current) loadStepRef.current(1)

      // Fetch MedicationRequests + Encounters + EpisodeOfCare + Observations directly from FHIR
      const fhirDirectPromise = Promise.all([
        callFhirApi(buildUrl('/baseR4/MedicationRequest', { patient: patientId, page: 0, size: 100 })).catch(e => { console.warn('[Dashboard] Meds fetch failed:', e); return null }),
        callFhirApi(`${FHIR_BASE}/baseR4/Encounter?patient=${patientId}&page=0&size=100`).catch(e => { console.warn('[Dashboard] Encounters fetch failed:', e); return null }),
        callFhirApi(buildUrl('/baseR4/EpisodeOfCare', { patient: patientId, status: 'active', page: 0, size: 100 })).catch(e => { console.warn('[Dashboard] EpisodeOfCare fetch failed:', e); return null }),
        callFhirApi(buildUrl('/baseR4/Observation/search', { patient: patientId, page: 0, size: 100 })).catch(e => { console.warn('[Dashboard] Observations fetch failed:', e); return null }),
        callFhirApi(buildUrl('/baseR4/Observation/vitals/search', { patient: patientId, page: 0, size: 100 })).catch(e => { console.warn('[Dashboard] Vitals fetch failed:', e); return null }),
        callFhirApi(buildUrl('/baseR4/Appointment', { patient: patientId, page: 0, size: 100 })).catch(e => { console.warn('[Dashboard] Appointments fetch failed:', e); return null })
      ]).then(async ([medBundle, encBundle, eocBundle, obsBundle, vitalsBundle, apptBundle]) => {
        const parsedMeds = parseMedsFromFhir(medBundle)
        if (parsedMeds?.length) {
          console.log('[Dashboard] Parsed', parsedMeds.length, 'medications from FHIR')
          setMedsData(parsedMeds)
        }
        const parsedEnc = parseEncountersFromFhir(encBundle)
        if (parsedEnc?.length) {
          console.log('[Dashboard] Parsed', parsedEnc.length, 'encounters from FHIR')
          setEncData(parsedEnc)
        }
        const parsedAppts = parseAppointmentsFromFhir(apptBundle)
        if (parsedAppts?.length) {
          console.log('[Dashboard] Parsed', parsedAppts.length, 'appointments from FHIR')
          setApptData(parsedAppts)
        }
        const parsedTeam = await parseCareTeamFromEoC(eocBundle)
        const teamWithUser = (() => {
          const team = parsedTeam || []
          const loggedInName = formatDisplayName(localStorage.getItem('cb_user') || '')
          const loggedInEmail = localStorage.getItem('cb_email') || ''
          if (loggedInName && !team.some(t => t.name.toLowerCase() === loggedInName.toLowerCase())) {
            const nameParts = loggedInName.split(/\s+/)
            const initials = nameParts.map(p => p[0]?.toUpperCase()).filter(Boolean).join('').slice(0, 2)
            team.unshift({ name: loggedInName, initials, role: 'Care Coordinator', program: 'Care Coordinator', email: loggedInEmail })
          }
          return team.length ? team : null
        })()
        if (teamWithUser?.length) {
          console.log('[Dashboard] Parsed', teamWithUser.length, 'care team members (including logged-in user)')
          setCareTeamData(teamWithUser)
        }
        const parsedVitals = parseVitalsFromFhir(vitalsBundle)
        if (parsedVitals?.length) {
          console.log('[Dashboard] Parsed', parsedVitals.length, 'vitals from dedicated vitals API')
          setVitalsData(parsedVitals)
        }
        const allObs = parseAllObservationsForTrends(obsBundle)
        if (allObs) {
          console.log('[Dashboard] Parsed observation trends for', Object.keys(allObs).length, 'types')
          setAllObsData(allObs)
        }
        const careManagerIds = eocBundle?.entry?.map(e => e.resource?.careManager?.reference?.replace('Practitioner/', '')).filter(Boolean) || []
        const parsedNotes = await parseClinicalNotesFromEncounters(encBundle, careManagerIds)
        if (parsedNotes?.length) {
          console.log('[Dashboard] Parsed', parsedNotes.length, 'clinical notes from encounters')
          setClinicalNotesData(parsedNotes)
        }
      })

      fetchRiskPrediction(patientId).then(risks => {
        if (risks?.length) {
          console.log('[Dashboard] Parsed', risks.length, 'risk predictions')
          setRiskData(risks)
        }
      })

      const parseDocRefNotes = (bundle, noteType) => {
        if (!bundle?.entry?.length) return []
        return bundle.entry.map(e => {
          const r = e.resource
          if (!r) return null
          const authorObj = r.author?.[0]
          const name = authorObj?.display || 'Unknown'
          const specialty = authorObj?.extension?.find(x => x.url === 'specialty')?.valueString || ''
          const nameParts = name.replace(/^(Dr\.|Mr\.|Ms\.|Mrs\.)\s*/i, '').trim().split(/\s+/)
          const initials = nameParts.map(p => p[0]?.toUpperCase()).filter(Boolean).join('').slice(0, 3)
          const dt = new Date(r.date)
          const dateStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
          let fullText = r.description || ''
          try { const b64 = r.content?.[0]?.attachment?.data; if (b64) fullText = atob(b64) } catch (_) {}
          return { author: name, initials, role: specialty || 'Physician', type: noteType, text: r.description || '', fullText, date: dateStr, rawDate: dt }
        }).filter(Boolean).sort((a, b) => b.rawDate - a.rawDate)
      }

      callFhirApi(`${FHIR_BASE}/baseR4/DocumentReference?patient=${patientId}&type.coding=11506-3&page=0&size=100`)
        .then(bundle => { const n = parseDocRefNotes(bundle, 'Clinical'); console.log('[Dashboard] Parsed', n.length, 'clinic document notes'); setClinicDocNotes(n) })
        .catch(e => console.warn('[Dashboard] Clinic doc notes fetch failed:', e))

      callFhirApi(`${FHIR_BASE}/baseR4/DocumentReference?patient=${patientId}&type.coding=34108-1&page=0&size=100`)
        .then(bundle => { const n = parseDocRefNotes(bundle, 'Admin'); console.log('[Dashboard] Parsed', n.length, 'admin document notes'); setAdminDocNotes(n) })
        .catch(e => console.warn('[Dashboard] Admin doc notes fetch failed:', e))

      await fhirDirectPromise
      return patientName
    }

    const generateOutreachMessage = async (pName, careContext, aiResult) => {
      setOutreachLoading(true)
      try {
        const alertSummary = (aiResult?.alerts || []).map(a => `${a.title}: ${a.detail} (${a.severity})`).join('; ')
        const prompt = `You are a care coordinator writing a patient outreach message. Write a warm, professional, and concise message to the patient.

Patient name: ${pName}
Care gaps identified: ${alertSummary || 'None identified'}

Requirements:
- Address the patient by first name
- Mention specific care gaps found (missed appointments, medication issues, etc.)
- Offer help with scheduling, medication refills, transportation
- Include a call-to-action (call us, reply, etc.)
- Keep it under 150 words
- Do NOT include subject line, just the message body
- Sign off as "Care Coordination Team"`

        const msg = await callAI('', prompt, { temperature: 0.7, maxTokens: 300 })
        if (msg) setOutreachMsg(msg)
      } catch (e) { console.warn('[Dashboard] Outreach message generation failed:', e) }
      finally { setOutreachLoading(false) }
    }

    async function loadAIInsights(pName) {
      try {
        const careGapText = sessionStorage.getItem('dashboard_caregap_' + patientId)

        let inputForAI = null
        if (careGapText) {
          console.log('[Dashboard] Using chatbot care gap text for analysis')
          inputForAI = `Care Gap Analysis for ${pName}:\n\n${careGapText}`
        } else {
          console.log('[Dashboard] No chatbot text, fetching FHIR data as fallback')
          const [obsResult, encResult, medResult, condResult] = await Promise.all([
            callFhirApi(buildUrl('/baseR4/Observation/search', { patient: patientId, page: 0, size: 100 })).catch(() => null),
            callFhirApi(buildUrl('/baseR4/Encounter', { patient: patientId, page: 0, size: 100 })).catch(() => null),
            callFhirApi(buildUrl('/baseR4/MedicationRequest', { patient: patientId, page: 0, size: 100 })).catch(() => null),
            callFhirApi(buildUrl('/baseR4/Condition', { patient: patientId, page: 0, size: 100 })).catch(() => null)
          ])
          const summary = summarizeFhirData(obsResult, encResult, medResult, condResult)
          inputForAI = `Patient: ${pName}\n\nFHIR Data:\n${JSON.stringify(summary)}`
        }

        const aiResult = await callAIForAnalysis(inputForAI)
        if (aiResult?.alerts) setAlertsData(aiResult.alerts)
        if (aiResult?.trends) setTrendsData(aiResult.trends)
        if (aiResult?.aiActions) setAiActionsData(aiResult.aiActions)
        if (aiResult?.missedAppointments?.length) setMissedAppts(aiResult.missedAppointments)
        generateOutreachMessage(pName, inputForAI, aiResult)
      } catch (e) {
        console.error('[Dashboard] AI analysis failed:', e)
      } finally {
        setAiLoading(false)
      }
    }

    Promise.all([loadDashboard(), minLoadTime]).then(([pName]) => {
      setIsLoading(false)
      loadAIInsights(pName || 'Patient')
    })
  }, [navigate, patientId])

  const d = MOCK_DATA
  const pt = patient || d.patient
  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })

  const toggleAction = (i) => {
    setSelectedActions(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])
  }

  const mapTask = (t) => ({
    id: t.actionId,
    title: t.action || 'Untitled',
    priority: t.priority ? (t.priority.charAt(0).toUpperCase() + t.priority.slice(1) + ' Priority') : 'Medium Priority',
    priorityClass: t.priority || 'medium',
    status: t.status === 'in-process' ? 'inprocess' : (t.status || 'pending'),
    dueDate: t.dueDate || '—',
    description: t.description || '',
    notes: t.aiRationale || '',
  })

  const fetchReviewStatus = async () => {
    try {
      const token = localStorage.getItem('cb_token')
      const res = await fetch(`${FHIR_BASE}/baseR4/portal/get-review?patientId=${patientId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (!res.ok) return
      const data = await maybeDecrypt(await res.json())
      if (data.isReviewed && data.createdDate) {
        const reviewDate = new Date(data.createdDate)
        const now = new Date()
        const diffDays = (now - reviewDate) / (1000 * 60 * 60 * 24)
        if (diffDays <= 7) {
          setIsReviewed(true)
          setLastReviewDate(reviewDate)
        } else {
          setIsReviewed(false)
          setLastReviewDate(reviewDate)
        }
      } else {
        setIsReviewed(false)
        setLastReviewDate(null)
      }
    } catch (e) { console.warn('[Dashboard] Review status fetch failed:', e) }
  }

  const handleMarkReviewed = async () => {
    try {
      const token = localStorage.getItem('cb_token')
      await fetch(`${FHIR_BASE}/baseR4/portal/create-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ patientId }),
      })
      await fetchReviewStatus()
    } catch (e) { console.warn('[Dashboard] Create review failed:', e) }
  }

  useEffect(() => { if (patientId) fetchReviewStatus() }, [patientId])

  const parseCareNoteEntry = (e) => {
    const r = e.resource
    if (!r) return null
    const name = r.author?.[0]?.display || 'Unknown'
    const role = r.author?.[0]?.extension?.find(x => x.url?.includes('coordinator-role'))?.valueString || 'Care Coordinator'
    const nameParts = name.replace(/^(Dr\.|Mr\.|Ms\.|Mrs\.)\s*/i, '').trim().split(/\s+/)
    const initials = nameParts.map(p => p[0]?.toUpperCase()).filter(Boolean).join('').slice(0, 3)
    const dt = new Date(r.date)
    const dateStr = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    const taskTitle = r.extension?.find(x => x.url === 'recommended-action')?.valueString || ''
    const taskStatus = r.extension?.find(x => x.url === 'status')?.valueString || ''
    const statusLabel = taskStatus === 'pending' ? 'Pending' : taskStatus === 'in-process' ? 'In Process' : taskStatus === 'completed' ? 'Completed' : taskStatus
    return { author: name, initials, role, type: 'Coordination', text: r.description || '', date: dateStr, rawDate: dt, ...(taskTitle ? { taskTitle, taskStatus: statusLabel } : {}) }
  }

  const fetchCareNotes = async (pid, tasks) => {
    try {
      const token = localStorage.getItem('cb_token')
      const pId = pid || patientId
      const email = encodeURIComponent(userEmail)
      const headers = { 'Authorization': `Bearer ${token}` }
      const taskList = tasks || taskQueue
      if (!taskList.length) {
        console.log('[Dashboard] No tasks in queue, skipping care notes fetch')
        setCareDocNotes([])
        return
      }
      const statusValues = ['pending', 'in-process', 'completed']
      const fetchPromises = taskList.flatMap(task => {
        const actionId = task.id
        return statusValues.map(status =>
          fetch(`${FHIR_BASE}/baseR4/CareCoordinationNote/search?patientId=${pId}&coordinatorEmail=${email}&actionId=${actionId}&status=${status}`, { headers })
            .then(r => r.ok ? r.json() : { entry: [] })
            .then(json => maybeDecrypt(json))
            .catch(() => ({ entry: [] }))
        )
      })
      const results = await Promise.all(fetchPromises)
      const seenIds = new Set()
      const allNotes = results.flatMap(bundle => (bundle?.entry || []).map(parseCareNoteEntry).filter(Boolean))
        .filter(n => {
          const key = `${n.author}-${n.rawDate?.getTime()}-${n.text}`
          if (seenIds.has(key)) return false
          seenIds.add(key)
          return true
        })
        .sort((a, b) => b.rawDate - a.rawDate)
      console.log('[Dashboard] Parsed', allNotes.length, 'care coordination notes from', taskList.length, 'tasks')
      setCareDocNotes(allNotes)
    } catch (e) { console.warn('[Dashboard] Care notes fetch failed:', e) }
  }

  const fetchTaskQueue = async () => {
    try {
      const token = localStorage.getItem('cb_token')
      const base = `${FHIR_BASE}/baseR4/portal/task-queue?patientId=${patientId}`
      const headers = { 'Authorization': `Bearer ${token}` }
      const [r1, r2, r3] = await Promise.all([
        fetch(`${base}&status=pending`, { headers }).then(r => r.ok ? r.json() : []).then(j => maybeDecrypt(j)).catch(() => []),
        fetch(`${base}&status=in-process`, { headers }).then(r => r.ok ? r.json() : []).then(j => maybeDecrypt(j)).catch(() => []),
        fetch(`${base}&status=completed`, { headers }).then(r => r.ok ? r.json() : []).then(j => maybeDecrypt(j)).catch(() => []),
      ])
      const all = [...(Array.isArray(r1) ? r1 : []), ...(Array.isArray(r2) ? r2 : []), ...(Array.isArray(r3) ? r3 : [])]
      const mappedTasks = all.map(mapTask)
      setTaskQueue(mappedTasks)
      if (userEmail) fetchCareNotes(null, mappedTasks)
    } catch (e) { console.warn('[Dashboard] Task queue fetch failed:', e) }
  }

  const handleApprove = async () => {
    setShowModal(false)
    const payload = selectedActions.map(i => {
      const a = displayActions[i]
      const due = new Date()
      if (a.timeframe?.includes('24 hours')) due.setDate(due.getDate() + 1)
      else if (a.timeframe?.includes('48 hours')) due.setDate(due.getDate() + 2)
      else if (a.timeframe?.includes('1 week')) due.setDate(due.getDate() + 7)
      else due.setDate(due.getDate() + 3)
      return {
        patientId,
        priority: (a.priorityClass || priorityClass(a.priority)).replace('pill-', ''),
        action: a.title,
        description: a.description,
        aiRationale: a.rationale,
        dueDate: due.toISOString().slice(0, 10),
      }
    })
    try {
      const token = localStorage.getItem('cb_token')
      await fetch(`${FHIR_BASE}/baseR4/portal/create-recommendations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload),
      })
    } catch (e) { console.warn('[Dashboard] Create recommendations failed:', e) }
    setSelectedActions([])
    setCoordinatorNotes('')
    setApproveAlert(true)
    setTimeout(() => setApproveAlert(false), 2000)
    await fetchTaskQueue()
  }

  const updateTaskStatus = async (taskId, newStatus, currentStatus) => {
    const apiNewStatus = newStatus === 'inprocess' ? 'in-process' : newStatus
    const apiCurrentStatus = currentStatus === 'inprocess' ? 'in-process' : currentStatus
    try {
      const token = localStorage.getItem('cb_token')
      await Promise.all([
        fetch(`${FHIR_BASE}/baseR4/portal/update-task?actionId=${taskId}&status=${apiNewStatus}`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${token}` },
        }),
        fetch(`${FHIR_BASE}/baseR4/CareCoordinationNote?email=${encodeURIComponent(userEmail)}&patientId=${patientId}&actionId=${taskId}&status=${apiCurrentStatus}`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${token}` },
        })
      ])
      console.log('[Dashboard] Task status updated + care notes patched to:', apiStatus)
    } catch (e) { console.warn('[Dashboard] Update task/notes failed:', e) }
    setTaskAlert(newStatus === 'inprocess' ? '▶ Task Started' : '✓ Task Completed')
    setTimeout(() => setTaskAlert(null), 2000)
    fetchTaskQueue()
    fetchCareNotes()
  }

  const handleTaskAddNote = async (taskId, taskTitle, taskStatus) => {
    const text = (taskNoteTexts[taskId] || '').trim()
    if (!text) return
    const apiStatus = taskStatus === 'inprocess' ? 'in-process' : taskStatus
    try {
      const token = localStorage.getItem('cb_token')
      await fetch(`${FHIR_BASE}/baseR4/CareCoordinationNote`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId,
          actionId: taskId,
          coordinatorEmail: userEmail,
          coordinatorName: userName,
          status: apiStatus,
          coordinatorRole: 'Care Coordinator',
          careNotes: text
        })
      })
      console.log('[Dashboard] Task note created via API for task:', taskTitle, 'status:', apiStatus)
    } catch (e) { console.warn('[Dashboard] Create task note failed:', e) }
    setTaskNoteTexts(prev => ({ ...prev, [taskId]: '' }))
    fetchCareNotes()
  }

  useEffect(() => { if (patientId) fetchTaskQueue() }, [patientId])

  const [generatedFallbackActions, setGeneratedFallbackActions] = useState(null)
  const fallbackGeneratedRef = useRef(false)

  const taskQueueTitles = new Set(taskQueue.map(t => t.title.toLowerCase()))
  const statusPriority = { completed: 3, inprocess: 2, pending: 1 }
  const dedupedTaskQueue = Object.values(
    taskQueue.reduce((acc, t) => {
      const key = t.title.toLowerCase()
      if (!acc[key] || (statusPriority[t.status] || 0) > (statusPriority[acc[key].status] || 0)) acc[key] = t
      return acc
    }, {})
  )

  const taskCounts = {
    pending: dedupedTaskQueue.filter(t => t.status === 'pending').length,
    inprocess: dedupedTaskQueue.filter(t => t.status === 'inprocess').length,
    completed: dedupedTaskQueue.filter(t => t.status === 'completed').length,
  }
  const filteredTasks = dedupedTaskQueue.filter(t => t.status === taskFilter)

  const rawActions = aiActionsData || d.aiActions
  const visibleActions = rawActions.filter((a, i) => !approvedActions.includes(i) && !taskQueueTitles.has(a.title.toLowerCase()))

  useEffect(() => {
    if (visibleActions.length === 0 && taskQueue.length > 0 && !fallbackGeneratedRef.current && !generatedFallbackActions) {
      fallbackGeneratedRef.current = true
      const existingTitles = [...taskQueueTitles].join(', ')
      const prompt = `You are a care coordination AI. A patient already has these approved tasks: [${existingTitles}]. Generate exactly 2 NEW and DIFFERENT follow-up actions for this patient's ongoing care. Return ONLY a JSON array with 2 objects, each having: title, priority ("High Priority"/"Medium Priority"/"Low Priority"), priorityClass ("high"/"medium"/"low"), timeframe ("Within 24 hours"/"Within 48 hours"/"Within 1 week"/"During next contact"), description (1 sentence), rationale (1 sentence). No markdown, no explanation, just the JSON array.`
      callAI('', prompt, { temperature: 0.7, maxTokens: 500 }).then(content => {
        try {
          const parsed = JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
          if (Array.isArray(parsed)) setGeneratedFallbackActions(parsed.slice(0, 2))
        } catch (_) { console.warn('[Dashboard] Fallback action generation parse failed') }
      }).catch(() => {})
    }
  }, [visibleActions.length, taskQueue.length])

  const displayActions = visibleActions.length > 0
    ? visibleActions
    : (generatedFallbackActions || []).filter(f => !taskQueueTitles.has(f.title.toLowerCase()))

  const priorityClass = (p) => {
    if (!p) return 'medium'
    const l = p.toLowerCase()
    if (l.includes('high')) return 'high'
    if (l.includes('low')) return 'low'
    return 'medium'
  }

  const clinicNotes = clinicDocNotes || clinicalNotesData?.filter(n => n.type === 'Clinical') || d.clinicalNotes.filter(n => n.type === 'Clinical')
  const adminNotes = adminDocNotes || []
  const careNotes = [...(careDocNotes || addedNotes.filter(n => n.type === 'Coordination'))].sort((a, b) => (b.rawDate || 0) - (a.rawDate || 0))
  const filteredNotes = noteFilter === 'clinical' ? clinicNotes
    : noteFilter === 'admin' ? adminNotes
    : careNotes
  const totalNotesCount = clinicNotes.length + adminNotes.length + careNotes.length
  const NOTES_PER_PAGE = 5
  const totalNotePages = Math.ceil(filteredNotes.length / NOTES_PER_PAGE)
  const paginatedNotes = filteredNotes.slice((notePage - 1) * NOTES_PER_PAGE, notePage * NOTES_PER_PAGE)

  const handleAddNote = async () => {
    if (!newNote.text.trim()) return
    try {
      const token = localStorage.getItem('cb_token')
      const res = await fetch(`${FHIR_BASE}/baseR4/CareCoordinationNote`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId,
          coordinatorEmail: userEmail,
          coordinatorName: userName,
          coordinatorRole: 'Care Coordinator',
          careNotes: newNote.text.trim()
        })
      })
      if (!res.ok) throw new Error(`${res.status}`)
      setNewNote({ author: '', role: '', type: 'Clinical', text: '' })
      setShowAddNoteModal(false)
      setNotePage(1)
      await fetchCareNotes()
    } catch (e) {
      console.error('[Dashboard] Failed to add care note:', e)
      const nameParts = userName.split(/\s+/)
      const initials = nameParts.map(p => p[0]?.toUpperCase()).filter(Boolean).join('').slice(0, 3)
      const now = new Date()
      const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      setAddedNotes(prev => [{ author: userName, initials, role: 'Care Coordinator', type: 'Coordination', text: newNote.text.trim(), date: dateStr, rawDate: now }, ...prev])
      setNewNote({ author: '', role: '', type: 'Clinical', text: '' })
      setShowAddNoteModal(false)
    }
  }

  const dynAlerts = alertsData || d.alerts.map(a => ({ title: a.title, detail: a.detail, severity: a.severity.toUpperCase() }))
  const dynTrends = trendsData || [
    { label: 'BP TREND', value: d.trends.bp, status: 'critical' },
    { label: 'HBA1C', value: d.trends.hba1c, status: 'high' },
    { label: 'LDL', value: d.trends.ldl, status: 'medium' }
  ]
  const activeGapCount = dynAlerts.filter(a => a.severity && a.severity.toUpperCase() !== 'NONE').length
  const dynamicPriority = activeGapCount >= 3 ? 'High' : activeGapCount === 2 ? 'Medium' : 'Low'
  const dynamicPriorityClass = activeGapCount >= 3 ? 'pill-red' : activeGapCount === 2 ? 'pill-orange' : 'pill-green'
  const hasCareGaps = activeGapCount > 0

  if (isLoading) return <LoadingScreen stepRef={loadStepRef} />

  return (
    <div className="dash-page">
      {/* ── Navbar ── */}
      <nav className="dash-nav">
        <div className="dash-nav-left">
          <img src="/images/Rsystems_Logo_White.png" alt="R Systems" className="dash-nav-logo" />
          <span className="dash-nav-title">Patient 360 Portal</span>
        </div>
        <div className="dash-nav-right">
          <div className="dash-nav-links">
            <span className="dash-nav-link active">Care Manager</span>
            <span className="dash-nav-link">Provider</span>
            <span className="dash-nav-link">Patients</span>
          </div>
          <button className="dash-nav-bell" title="Notifications">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
          </button>
          <div className="dash-nav-user-info">
            <span className="dash-nav-username">{userName}</span>
            <span className="dash-nav-userrole">ADMIN</span>
          </div>
          <div className="dash-nav-avatar">{userName.charAt(0)}</div>
        </div>
      </nav>

      {/* ── Sub-header ── */}
      <div className="dash-subheader">
        <div className="dash-breadcrumb">
          <button className="dash-back-btn" onClick={() => navigate('/')} title="Back">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className="dash-bc-text">Care Manager Dashboard</span>
              <span className="dash-bc-sep">›</span>
              <span className="dash-bc-name">{pt.name}</span>
            </div>
            <p className="dash-bc-sub">Patient Profile &amp; Care Management</p>
          </div>
        </div>
        <div className="dash-quick-pills">
          <button onClick={() => scrollTo('vitals-section')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            Vitals
          </button>
          <button onClick={() => scrollTo('meds-section')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>
            Medications
          </button>
          <button onClick={() => scrollTo('appts-section')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            Appointments
          </button>
        </div>
      </div>

      {/* ── Patient Banner ── */}
      <div className="dash-banner">
        <div className="dash-banner-left">
          <div className="dash-banner-avatar">{pt.initials}</div>
          <div className="dash-banner-info">
            <div className="dash-banner-name-row">
              <h2>{pt.name}</h2>
              {!aiLoading && <>
                <span className={`dash-pill ${dynamicPriorityClass}`}>{dynamicPriority} Priority</span>
                {hasCareGaps
                  ? <span className="dash-pill pill-red-outline">⚠ Care Gap</span>
                  : <span className="dash-pill pill-green-outline">✓ No Care Gaps Detected</span>
                }
              </>}
            </div>
            <div className="dash-banner-meta">
              <span>{pt.age} yrs</span>
              <span className="dash-meta-sep">·</span>
              <span>{pt.gender}</span>
              <span className="dash-meta-sep">·</span>
              <span>MRN: {pt.mrn}</span>
              <span className="dash-meta-sep">·</span>
              <span>Programs: Diabetes, Hypertension</span>
            </div>
            <div className="dash-banner-contact">
              <span><img src="/images/icon-calendar.png" alt="" className="dash-banner-icon" /> DOB: {pt.dob}</span>
              <span><img src="/images/icon-phone.png" alt="" className="dash-banner-icon" /> {pt.phone}</span>
              <span>✉ {pt.email}</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
          <button
            className={`dash-review-btn ${isReviewed ? 'reviewed' : ''}`}
            onClick={isReviewed ? undefined : handleMarkReviewed}
            style={isReviewed ? { cursor: 'default' } : {}}
          >
            {isReviewed ? '✓ Reviewed' : '✓ Mark as Reviewed'}
          </button>
          {lastReviewDate && (
            <span style={{ fontSize: '11px', color: '#94A3B8' }}>
              Last reviewed: {lastReviewDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          )}
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="dash-grid">
        {/* ─ Left / Main Column ─ */}
        <div className="dash-col-main">
          {/* Alerts + Risk combined card */}
          <div className="dash-card dash-alerts-card">
            <div className="dash-alerts-inner">
              <div className="dash-alerts-left">
                <div className="dash-card-head">
                  <h3>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" width="18" height="18"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    Alert Triggers &amp; Risk Drivers
                  </h3>
                  <p>AI-detected issues requiring immediate attention</p>
                </div>
                {aiLoading ? (
                  <div className="ai-loading-inline">
                    <div className="ai-loading-spinner"></div>
                    <p>Analyzing clinical data...</p>
                  </div>
                ) : (<>
                <div className="dash-alert-list">
                  {dynAlerts.map((a, i) => {
                    const isNone = a.severity?.toUpperCase() === 'NONE'
                    return (
                      <div key={i} className={`dash-alert-item ${isNone ? 'dash-alert-none' : ''}`}>
                        <span className="dash-alert-icon">{ALERT_ICONS[a.title] === 'pill-img' ? <img src="/images/icon-pill.png" alt="" className="dash-alert-img" /> : ALERT_ICONS[a.title] === 'calendar-img' ? <img src="/images/icon-calendar.png" alt="" className="dash-alert-img" /> : (ALERT_ICONS[a.title] || '⚠')}</span>
                        <div className="dash-alert-body">
                          <strong>{a.title}</strong>
                          <p>{isNone ? 'No care gaps detected' : a.detail}</p>
                        </div>
                        {isNone
                          ? <span className="dash-pill pill-green">NONE</span>
                          : <span className={`dash-pill sev-${a.severity.toLowerCase()}`}>{a.severity}</span>
                        }
                      </div>
                    )
                  })}
                </div>
                <div className="dash-trends-bar">
                  <div className="dash-trends-label">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="2" width="16" height="16"><path d="M23 6l-9.5 9.5-5-5L1 18"/></svg>
                    DETERIORATING CLINICAL TRENDS
                  </div>
                  <div className="dash-trends-scroll">
                    {dynTrends.map((t, i) => {
                      const severityMatch = t.value.match(/(↑\s*|↓\s*)?(CRITICAL|HIGH|MEDIUM|LOW)\s*$/i)
                      const rangeMatch = t.value.match(/\(Normal:?\s*[^)]+\)/i)
                      let mainVal = t.value
                      let rangeStr = ''
                      let severityStr = ''
                      if (severityMatch) { severityStr = severityMatch[0].trim(); mainVal = mainVal.replace(severityMatch[0], '').trim() }
                      if (rangeMatch) { rangeStr = rangeMatch[0]; mainVal = mainVal.replace(rangeMatch[0], '').trim() }
                      const sevClass = severityStr.toLowerCase().includes('critical') ? 'sev-critical' : severityStr.toLowerCase().includes('high') ? 'sev-high' : severityStr.toLowerCase().includes('medium') ? 'sev-medium' : 'sev-low'
                      return (
                        <div key={i} className={`dash-trend-chip ${t.status}`}>
                          <span className="dash-trend-lbl">{t.label}</span>
                          <span className="dash-trend-val">{mainVal}</span>
                          {rangeStr && <span className="dash-trend-range">{rangeStr}</span>}
                          {severityStr && <span className={`dash-trend-sev ${sevClass}`}>{severityStr}</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
                </>)}
              </div>
              <div className="dash-alerts-right">
                <div className="ri-head">
                  <span className="ri-title">Risk Insights</span>
                  <span className="ri-ai">
                    <svg viewBox="0 0 512 480.24" fill="currentColor" width="10" height="10"><path d="M512 220.6c-163.88 61.72-149.02 38.94-206.92 208.29-57.91-169.35-43.06-146.57-206.92-208.26 163.86-61.72 149.01-38.95 206.92-208.3C362.98 181.68 348.12 158.91 512 220.6zM193.38 382.9c-76.59 28.86-69.65 18.21-96.71 97.34C69.63 401.11 76.59 411.76 0 382.9c76.59-28.81 69.63-18.15 96.67-97.31 27.06 79.16 20.12 68.5 96.71 97.31zm8.2-316.66c-52.13 19.66-47.41 12.38-65.81 66.28-18.43-53.86-13.69-46.62-65.84-66.28C122.08 46.63 117.34 53.87 135.77 0c18.4 53.87 13.68 46.63 65.81 66.24z"/></svg>
                    AI Powered
                  </span>
                </div>
                <div className="ri-list">
                  {(riskData || d.riskInsights).map((r, i) => (
                    <div key={i} className={`ri-row ri-row-${r.level}`} onClick={() => r.drivers && setViewingRisk(r)} role="button" tabIndex={0}>
                      {r.icon && <div className={`ri-icon ri-icon-${r.level}`}><img src={r.icon} alt="" width="18" height="18" /></div>}
                      <div className="ri-info">
                        <div className="ri-name">{r.name}</div>
                        <div className="ri-pct">{r.value}</div>
                      </div>
                      <span className={`ri-badge ri-badge-${r.level}`}>{r.level === 'mod' ? 'MODERATE' : (r.levelLabel || r.level).toUpperCase()}</span>
                    </div>
                  ))}
                </div>
                <p className="ri-hint">Tap a tile to see detailed insights</p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="dash-tabs">
            <button className={`dash-tab ${activeTab === 'actions' ? 'active' : ''}`} onClick={() => setActiveTab('actions')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              AI Actions
            </button>
            <button className={`dash-tab ${activeTab === 'trends' ? 'active' : ''}`} onClick={() => setActiveTab('trends')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 6-6"/></svg>
              Clinical Trends
            </button>
            <button className={`dash-tab ${activeTab === 'queue' ? 'active' : ''}`} onClick={() => setActiveTab('queue')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/></svg>
              Task Queue
            </button>
            <button className={`dash-tab ${activeTab === 'outreach' ? 'active' : ''}`} onClick={() => setActiveTab('outreach')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              Patient Outreach
            </button>
          </div>

          {/* AI Actions */}
          {activeTab === 'actions' && <>{aiLoading ? (
            <div className="dash-card dash-actions-section">
              <div className="ai-loading-inline" style={{ padding: '40px 0' }}>
                <div className="ai-loading-spinner"></div>
                <p>Generating AI recommendations...</p>
              </div>
            </div>
          ) : (<div className="dash-card dash-actions-section">
            <div className="dash-actions-head">
              <div>
                <h3>AI-Recommended Actions</h3>
                <p>Select actions to approve and create tasks ({selectedActions.length} selected)</p>
              </div>
              <div className="dash-actions-head-right">
                {approveAlert && <span className="dash-approve-alert">✓ Tasks approved successfully!</span>}
                <button
                  className="dash-approve-btn"
                  disabled={selectedActions.length === 0}
                  onClick={() => setShowModal(true)}
                >
                  ✓ Approve Selected ({selectedActions.length})
                </button>
              </div>
            </div>
            {displayActions.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#94A3B8', padding: '32px 0', fontSize: '14px' }}>✅ All actions have been approved and moved to Task Queue</p>
            ) : displayActions.map((a, i) => {
              const due = new Date()
              if (a.timeframe?.includes('24 hours')) due.setDate(due.getDate() + 1)
              else if (a.timeframe?.includes('48 hours')) due.setDate(due.getDate() + 2)
              else if (a.timeframe?.includes('1 week')) due.setDate(due.getDate() + 7)
              else due.setDate(due.getDate() + 3)
              const dueStr = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              return (
                <div key={i} className={`dash-action-row ${selectedActions.includes(i) ? 'selected' : ''}`}>
                  <input type="checkbox" checked={selectedActions.includes(i)} onChange={() => toggleAction(i)} />
                  <div className="dash-action-body">
                    <div className="dash-action-title-row">
                      <strong>{a.title}</strong>
                      <span className={`dash-pill pill-${a.priorityClass || priorityClass(a.priority)}`}>{a.priority}</span>
                      <span className="dash-action-time"><img src="/images/icon-calendar.png" alt="" className="dash-banner-icon" /> Due: {dueStr}</span>
                    </div>
                    <p>{a.description}</p>
                    <div className="dash-rationale">
                      <span className="dash-rationale-tag">AI RATIONALE:</span>
                      <em>{a.rationale}</em>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>)}

          {/* Approve Modal */}
          {showModal && (
            <div className="dash-modal-overlay" onClick={() => setShowModal(false)}>
              <div className="dash-modal" onClick={e => e.stopPropagation()}>
                <div className="dash-modal-header">
                  <div>
                    <h3>Approve &amp; Create Tasks</h3>
                    <p>Review selected actions and add coordinator notes before creating tasks</p>
                  </div>
                  <button className="dash-modal-close" onClick={() => setShowModal(false)}>✕</button>
                </div>
                <div className="dash-modal-body">
                  <p className="dash-modal-label">Selected Actions ({selectedActions.length}):</p>
                  <div className="dash-modal-actions-list">
                    {selectedActions.map(i => {
                      const a = displayActions[i]
                      return (
                        <div key={i} className="dash-modal-action-item">
                          <span className="dash-modal-check">✓</span>
                          <div>
                            <strong>{a.title}</strong>
                            <p>{a.description}</p>
                          </div>
                          <span className={`dash-pill pill-${a.priorityClass || priorityClass(a.priority)}`}>{a.priority}</span>
                        </div>
                      )
                    })}
                  </div>
                  <div className="dash-modal-assignment">
                    <strong>Assignment:</strong>
                    <p>Tasks will be created and assigned to <b>your task queue</b> for immediate action.</p>
                  </div>
                </div>
                <div className="dash-modal-footer">
                  <button className="dash-modal-cancel" onClick={() => setShowModal(false)}>✕ Cancel</button>
                  <button className="dash-modal-confirm" onClick={handleApprove}>✓ Confirm &amp; Create Tasks</button>
                </div>
              </div>
            </div>
          )}
          </>}

          {/* Patient Outreach */}
          {activeTab === 'outreach' && (
            <div className="dash-card po-card">
              <div className="po-channels">
                {/* Phone Call */}
                <div className="po-channel po-channel-blue">
                  <div className="po-channel-header">
                    <div className="po-channel-icon po-icon-blue">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    </div>
                    <h4>Phone Call</h4>
                  </div>
                  <p className="po-channel-desc">Direct phone outreach to discuss care gaps</p>
                  <button className="po-channel-btn po-btn-blue">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    Initiate Call
                  </button>
                </div>
                {/* SMS */}
                <div className="po-channel po-channel-green">
                  <div className="po-channel-header">
                    <div className="po-channel-icon po-icon-green">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    </div>
                    <h4>SMS Message</h4>
                  </div>
                  <p className="po-channel-desc">Send text reminder for medication refill</p>
                  <button className="po-channel-btn po-btn-green">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    Send SMS
                  </button>
                </div>
                {/* Email */}
                <div className="po-channel po-channel-purple">
                  <div className="po-channel-header">
                    <div className="po-channel-icon po-icon-purple">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                    </div>
                    <h4>Email Portal</h4>
                  </div>
                  <p className="po-channel-desc">Send educational materials via portal</p>
                  <a href={`mailto:${pt.email || ''}`} className="po-channel-btn po-btn-purple">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                    Send Email
                  </a>
                </div>
              </div>

              <div className="po-template">
                <div>
                  <h3 className="po-template-title">Outreach Communication Template</h3>
                  <p className="po-template-sub">Customize message for patient contact</p>
                </div>
                <div className="po-template-body">
                  <label className="po-msg-label">MESSAGE</label>
                  {outreachLoading ? (
                    <div className="po-msg-loading">
                      <span className="ai-loading-spinner" style={{ width: 18, height: 18 }} /> Generating personalized message...
                    </div>
                  ) : (
                    <textarea
                      className="po-msg-textarea"
                      value={outreachMsg || `Hello ${pt.name?.split(' ')[0] || 'Patient'}, This is [Coordinator Name] from your care team. We noticed you may have missed some medication refills and your recent follow-up appointment. We're here to help and want to make sure you have everything you need. Could we schedule a time to talk about any challenges you're facing with your medications or appointments? We can also help with:\n- Medication refills and pharmacy assistance\n- Rescheduling appointments\n- Transportation support\nPlease call us at (555) 123-4567 or reply to this message. We're here to support your health goals.\nBest regards, Care Coordination Team`}
                      onChange={e => setOutreachMsg(e.target.value)}
                    />
                  )}
                </div>
                <div className="po-template-actions">
                  <a href={`mailto:${pt.email || ''}?subject=${encodeURIComponent(`Care Coordination Follow-Up – ${pt.name || 'Patient'}`)}&body=${encodeURIComponent(outreachMsg || `Hello ${pt.name?.split(' ')[0] || 'Patient'}, This is [Coordinator Name] from your care team. We noticed you may have missed some medication refills and your recent follow-up appointment. We're here to help and want to make sure you have everything you need. Could we schedule a time to talk about any challenges you're facing with your medications or appointments? We can also help with:\n- Medication refills and pharmacy assistance\n- Rescheduling appointments\n- Transportation support\nPlease call us at (555) 123-4567 or reply to this message. We're here to support your health goals.\nBest regards, Care Coordination Team`)}`} className="po-send-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    Send to Patient
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Clinical Trends */}
          {activeTab === 'trends' && (() => {
            const dynamicTabs = buildDynamicTrendTabs(allObsData, dynTrends)
            const activeCfg = dynamicTabs.find(t => t.key === trendTab) || dynamicTabs[0]
            return (
            <div className="dash-card" style={{ padding: '24px' }}>
              <div className="ct-header">
                <div>
                  <h3 className="ct-title">Longitudinal Clinical Health</h3>
                  <p className="ct-subtitle">Vitals Trends</p>
                </div>
                <div className="ct-period-toggle">
                  <button className={trendPeriod === '12m' ? 'active' : ''} onClick={() => setTrendPeriod(trendPeriod === '12m' ? 'all' : '12m')}>12 Month View</button>
                </div>
              </div>

              {!dynamicTabs.length ? (
                <p style={{ textAlign: 'center', color: '#94A3B8', padding: '40px 0' }}>No observation data available</p>
              ) : (<>
              <div className="ct-tabs">
                {dynamicTabs.map(tab => (
                  <button key={tab.key} className={`ct-tab ${activeCfg?.key === tab.key ? 'active' : ''}`} onClick={() => setTrendTab(tab.key)}>{tab.label}</button>
                ))}
              </div>

              <div className="ct-chart-area">
                {(() => {
                  const cfg = activeCfg
                  if (!allObsData || !cfg) return <p style={{ textAlign: 'center', color: '#94A3B8', padding: '40px 0' }}>No observation data available</p>

                  const cutoff = trendPeriod === '12m' ? new Date(new Date().setFullYear(new Date().getFullYear() - 1)) : null

                  const datasets = []
                  const allDates = new Set()
                  cfg.codes.forEach((code, idx) => {
                    const obs = allObsData[code]
                    if (!obs) return
                    const filtered = cutoff ? obs.points.filter(p => p.date >= cutoff) : obs.points
                    filtered.forEach(p => allDates.add(p.date.toISOString().slice(0, 10)))
                    datasets.push({
                      label: OBSERVATION_NORMAL_RANGES[code]?.name || obs.display,
                      data: filtered.map(p => ({ x: p.date.toISOString().slice(0, 10), y: p.value })),
                      borderColor: cfg.colors[idx % cfg.colors.length],
                      backgroundColor: cfg.fill ? (cfg.colors[idx % cfg.colors.length]) + '20' : 'transparent',
                      fill: !!cfg.fill,
                      tension: 0.3,
                      pointRadius: 5,
                      pointHoverRadius: 7,
                      borderWidth: 2,
                    })
                  })

                  if (!datasets.length || !allDates.size) return <p style={{ textAlign: 'center', color: '#94A3B8', padding: '40px 0' }}>No data for selected period</p>

                  const labels = [...allDates].sort()
                  datasets.forEach(ds => {
                    const mapped = labels.map(lbl => {
                      const pt = ds.data.find(d => d.x === lbl)
                      return pt ? pt.y : null
                    })
                    ds.data = mapped
                  })

                  if (cfg.targets) {
                    cfg.targets.forEach((t, idx) => {
                      if (t != null) {
                        datasets.push({
                          label: 'Target' + (cfg.targets.length > 1 ? ` (${t})` : ''),
                          data: labels.map(() => t),
                          borderColor: cfg.colors[idx % cfg.colors.length] || '#94A3B8',
                          borderDash: [6, 4],
                          borderWidth: 1.5,
                          pointRadius: 0,
                          fill: false,
                        })
                      }
                    })
                  }

                  const options = {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    spanGaps: true,
                    plugins: {
                      legend: { position: 'bottom', labels: { usePointStyle: true, padding: 16, font: { size: 11 } } },
                      tooltip: {
                        backgroundColor: '#fff', titleColor: '#1E293B', bodyColor: '#475569', borderColor: '#E2E8F0', borderWidth: 1,
                        padding: 12, cornerRadius: 8, titleFont: { weight: '600' },
                        callbacks: {
                          title: (items) => { const d = new Date(labels[items[0].dataIndex]); const mm = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0'); const yy = String(d.getFullYear()).slice(-2); return `${mm}-${dd}-${yy}` },
                          label: (ctx) => {
                            if (ctx.raw == null) return null
                            return ctx.raw
                          }
                        }
                      },
                    },
                    scales: {
                      x: { grid: { display: false }, ticks: { font: { size: 10 }, maxTicksLimit: 8, callback: (_, i) => { const d = new Date(labels[i]); const mm = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0'); const yy = String(d.getFullYear()).slice(-2); return `${mm}-${dd}-${yy}` } } },
                      y: { grid: { color: '#F1F5F9' }, ticks: { font: { size: 11 } }, beginAtZero: true },
                    },
                  }

                  return <div style={{ height: '300px' }}><Line data={{ labels, datasets }} options={options} /></div>
                })()}
              </div>

              <div className="ct-legend-info">
                {activeCfg?.targetLabels?.map((lbl, i) => <span key={i} className="ct-legend-item">{lbl}</span>) || null}
              </div>
              </>)}

              <div className="ct-bottom-stats">
                {(() => {
                  if (!allObsData) return null
                  const stats = []
                  const topCodes = Object.entries(allObsData)
                    .filter(([, v]) => v.points.length >= 2)
                    .sort((a, b) => b[1].points.length - a[1].points.length)
                    .slice(0, 3)

                  for (const [code, obs] of topCodes) {
                    const pts = obs.points
                    const range = OBSERVATION_NORMAL_RANGES[code]
                    const name = range?.name || obs.display
                    const unit = range?.unit || obs.unit || ''
                    const first = pts[0].value, last = pts[pts.length - 1].value
                    const pctChange = (((last - first) / first) * 100).toFixed(0)
                    const isAbnormal = range && (last > range.high || last < range.low)
                    stats.push({
                      icon: isAbnormal ? '⚠️' : '📊',
                      label: `${name} TREND`,
                      value: `${pctChange > 0 ? '+' : ''}${pctChange}% (Latest: ${last} ${unit})`,
                    })
                  }
                  return stats.map((s, i) => (
                    <div key={i} className="ct-stat">
                      <span className="ct-stat-icon">{s.icon}</span>
                      <div>
                        <p className="ct-stat-label">{s.label}</p>
                        <p className="ct-stat-value">{s.value}</p>
                      </div>
                    </div>
                  ))
                })()}
              </div>
            </div>
            )
          })()}

          {/* Task Queue */}
          {activeTab === 'queue' && (
            <div className="dash-card" style={{ padding: '24px' }}>
              <div className="tq-summary">
                <div className={`tq-summary-card ${taskFilter === 'pending' ? 'tq-active' : ''}`} onClick={() => setTaskFilter('pending')}>
                  <div className="tq-summary-icon tq-icon-pending">⏳</div>
                  <div>
                    <div className="tq-summary-label">Pending</div>
                    <span className="tq-badge tq-badge-pending">{taskCounts.pending} Tasks</span>
                  </div>
                </div>
                <div className={`tq-summary-card ${taskFilter === 'inprocess' ? 'tq-active' : ''}`} onClick={() => setTaskFilter('inprocess')}>
                  <div className="tq-summary-icon tq-icon-inprocess">▶</div>
                  <div>
                    <div className="tq-summary-label">In Process</div>
                    <span className="tq-badge tq-badge-inprocess">{taskCounts.inprocess} Tasks</span>
                  </div>
                </div>
                <div className={`tq-summary-card ${taskFilter === 'completed' ? 'tq-active' : ''}`} onClick={() => setTaskFilter('completed')}>
                  <div className="tq-summary-icon tq-icon-completed">✓</div>
                  <div>
                    <div className="tq-summary-label">Completed</div>
                    <span className="tq-badge tq-badge-completed">{taskCounts.completed} Tasks</span>
                  </div>
                </div>
              </div>

              <div className="tq-section-header">
                <h3>⏳ {taskFilter === 'pending' ? 'Pending' : taskFilter === 'inprocess' ? 'In Process' : 'Completed'} Tasks</h3>
                <p>{taskFilter === 'pending' ? 'Tasks awaiting action' : taskFilter === 'inprocess' ? 'Tasks currently being worked on' : 'Tasks that have been finished'}</p>
                {taskAlert && <span className="dash-approve-alert">{taskAlert}</span>}
              </div>

              {filteredTasks.length === 0 && (
                <div className="tq-empty">
                  <p>{taskFilter === 'pending' ? 'No pending tasks. Approve actions from the AI Actions tab to create tasks.' : taskFilter === 'inprocess' ? 'No tasks in process.' : 'No completed tasks yet.'}</p>
                </div>
              )}

              {filteredTasks.map(task => (
                <div key={task.id} className="tq-task-card">
                  <div className="tq-task-header">
                    <h4>{task.title}</h4>
                  </div>
                  <div className="tq-task-meta">
                    <span className={`dash-pill pill-${task.priorityClass}`}>{task.priority}</span>
                    <span className={`dash-pill tq-status-pill tq-status-${task.status}`}>
                      {task.status === 'pending' ? 'Pending' : task.status === 'inprocess' ? 'In Process' : 'Completed'}
                    </span>
                    <span className="tq-due"><img src="/images/icon-calendar.png" alt="" className="dash-banner-icon" /> DUE: {task.dueDate}</span>
                  </div>
                  <p className="tq-task-desc">{task.description}</p>
                  <div className="tq-notes">
                    <span className="tq-notes-label">AI NOTES:</span>
                    <p>{task.notes}</p>
                  </div>
                  <div className="tq-user-notes">
                    <span className="tq-notes-label">Notes:</span>
                    <textarea className="tq-note-input" placeholder="Add a note..." value={taskNoteTexts[task.id] || ''} onChange={e => setTaskNoteTexts(prev => ({ ...prev, [task.id]: e.target.value }))} />
                    <button className="tq-add-note-btn" onClick={() => handleTaskAddNote(task.id, task.title, task.status)} disabled={!(taskNoteTexts[task.id] || '').trim()}>Add Note</button>
                  </div>
                  <div className="tq-task-actions">
                    {task.status === 'pending' && (
                      <>
                        <button className="tq-btn-start" onClick={() => updateTaskStatus(task.id, 'inprocess', 'pending')}>▶ Start Task</button>
                        <button className="tq-btn-complete" onClick={() => updateTaskStatus(task.id, 'completed', 'pending')}>✓ Mark Complete</button>
                      </>
                    )}
                    {task.status === 'inprocess' && (
                      <button className="tq-btn-complete" onClick={() => updateTaskStatus(task.id, 'completed', 'inprocess')}>✓ Mark Complete</button>
                    )}
                    {task.status === 'completed' && (
                      <span className="tq-completed-label">✓ Completed</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Vitals / Latest Observations */}
          <div id="vitals-section" className="dash-card">
            <div className="dash-card-head">
              <h3>Vitals</h3>
              <p>{vitalsData ? `${vitalsData.length} vitals` : 'Last updated: Today, 9:30 AM'}</p>
            </div>
            {(() => {
              const allVitals = vitalsData || d.vitals
              const visible = showAllVitals ? allVitals : allVitals.slice(0, 4)
              return (
                <>
                  <div className="dash-vitals-grid">
                    {visible.map((v, i) => {
                      const defaultIcon = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                      return (
                        <div key={i} className={`dash-vital ${v.status}`}>
                          <div className="dash-vital-icon">{VITAL_ICONS[v.name] || defaultIcon}</div>
                          <div className="dash-vital-data">
                            <span className="dash-vital-label">{v.name}</span>
                            <span className={`dash-vital-value ${v.status}`}>{v.value} <small>{v.unit}</small></span>
                            <div className={`dash-vital-bar ${v.status}`}><div style={{ width: `${v.pct}%` }}></div></div>
                          </div>
                          <div className="dash-vital-normal">Normal<br /><b>{v.normal}</b></div>
                        </div>
                      )
                    })}
                  </div>
                  {allVitals.length > 4 && (
                    <button className="dash-show-more-btn" onClick={() => setShowAllVitals(v => !v)}>
                      {showAllVitals ? '▲ Show Less' : `▼ Show All (${allVitals.length - 4} more)`}
                    </button>
                  )}
                </>
              )
            })()}
          </div>

          {/* Medications */}
          <div id="meds-section" className="dash-card">
            <div className="dash-card-head">
              <h3>Medications</h3>
              <p>{(medsData || d.medications).length} medications</p>
            </div>
            {(() => {
              const allMeds = medsData || d.medications
              const MEDS_PER_PAGE = 10
              const totalMedPages = Math.ceil(allMeds.length / MEDS_PER_PAGE)
              const pagedMeds = allMeds.slice((medsPage - 1) * MEDS_PER_PAGE, medsPage * MEDS_PER_PAGE)
              const statusClass = s => { const l = s?.toLowerCase() || ''; return l === 'discontinued' || l === 'stopped' ? 'pill-stopped' : l === 'on-hold' || l === 'on hold' ? 'pill-onhold' : l === 'completed' ? 'pill-completed-grey' : 'pill-active' }
              return (
                <>
                  {pagedMeds.map((m, i) => (
                    <div key={i} className="dash-med-row">
                      <div className="dash-med-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="2" width="18" height="18"><path d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-6 18h6"/></svg>
                      </div>
                      <div className="dash-med-info">
                        <div className="dash-med-name">{m.name} {m.dose && <small>({m.dose})</small>} <span className={`dash-pill ${statusClass(m.status)}`}>{m.status || 'Active'}</span></div>
                        <p>{[m.frequency, m.note].filter(Boolean).join(' · ') || 'No additional details'}</p>
                      </div>
                    </div>
                  ))}
                  {totalMedPages > 1 && (
                    <div className="cn-pagination">
                      {medsPage > 1 && <button className="cn-page-btn" onClick={() => setMedsPage(p => p - 1)}>‹ Prev</button>}
                      {Array.from({ length: totalMedPages }, (_, i) => i + 1).map(pg => (
                        <button key={pg} className={`cn-page-btn ${medsPage === pg ? 'cn-page-active' : ''}`} onClick={() => setMedsPage(pg)}>{pg}</button>
                      ))}
                      {medsPage < totalMedPages && <button className="cn-page-btn" onClick={() => setMedsPage(p => p + 1)}>Next ›</button>}
                    </div>
                  )}
                </>
              )
            })()}
          </div>

          {/* Appointments & Encounters */}
          <div id="appts-section" className="dash-card">
            <div className="dash-card-head">
              <h3>Appointments &amp; Encounters</h3>
              <p>{encApptTab === 'encounters'
                ? `${(encData || []).filter(e => !e.isMissed).length} encounters`
                : `${(() => { const all = [...(apptData || []), ...(missedAppts || []).map(m => ({ date: m.date, location: m.location || '' }))]; const seen = new Set(); let c = 0; for (const a of all) { const k = `${(a.date || '').replace(/\s+/g, '')}|${(a.location || '').toLowerCase().trim()}`; if (!seen.has(k)) { seen.add(k); c++ } } return c })()} appointments`
              }</p>
            </div>
            <div className="dash-enc-appt-tabs">
              <button className={`dash-enc-appt-tab ${encApptTab === 'encounters' ? 'active' : ''}`} onClick={() => { setEncApptTab('encounters'); setApptsPage(1) }}>Encounters</button>
              <button className={`dash-enc-appt-tab ${encApptTab === 'appointments' ? 'active' : ''}`} onClick={() => { setEncApptTab('appointments'); setApptPageNum(1) }}>Appointments</button>
            </div>

            {encApptTab === 'encounters' && (() => {
              const fhirEnc = (encData || []).filter(e => !e.isMissed)
              const ITEMS = 10
              const totalPages = Math.ceil(fhirEnc.length / ITEMS)
              const paged = fhirEnc.slice((apptsPage - 1) * ITEMS, apptsPage * ITEMS)
              return (
                <>
                  {paged.map((a, i) => (
                    <div key={i} className="dash-appt-row">
                      <div className="dash-appt-info">
                        <div className="dash-appt-title">
                          <strong>{a.title}</strong>
                          <span className={`dash-pill pill-${a.status}`}>{a.status === 'upcoming' ? 'Upcoming' : a.status === 'completed' ? 'Completed' : a.status === 'stopped' ? 'Stopped' : a.status}</span>
                        </div>
                        {a.with && <p>with {a.with}</p>}
                        <p className="dash-appt-meta">
                          {a.date && <><img src="/images/icon-calendar.png" alt="" className="dash-banner-icon" /> {a.date}</>}
                          {a.time && <>&nbsp; <svg viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" width="14" height="14" style={{verticalAlign:'middle',marginRight:2}}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>{a.time}</>}
                          {a.endDate && <>&nbsp; → &nbsp;<img src="/images/icon-calendar.png" alt="" className="dash-banner-icon" /> {a.endDate}</>}
                          {a.endTime && <>&nbsp; <svg viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" width="14" height="14" style={{verticalAlign:'middle',marginRight:2}}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>{a.endTime}</>}
                          {a.location && <>&nbsp; 📍 {a.location}</>}
                        </p>
                      </div>
                    </div>
                  ))}
                  {totalPages > 1 && (
                    <div className="cn-pagination">
                      {apptsPage > 1 && <button className="cn-page-btn" onClick={() => setApptsPage(p => p - 1)}>‹ Prev</button>}
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map(pg => (
                        <button key={pg} className={`cn-page-btn ${apptsPage === pg ? 'cn-page-active' : ''}`} onClick={() => setApptsPage(pg)}>{pg}</button>
                      ))}
                      {apptsPage < totalPages && <button className="cn-page-btn" onClick={() => setApptsPage(p => p + 1)}>Next ›</button>}
                    </div>
                  )}
                </>
              )
            })()}

            {encApptTab === 'appointments' && (() => {
              const aiMissed = (missedAppts || []).map(m => ({
                title: m.title, status: 'missed', with: m.reason || 'No-Show',
                date: m.date, time: '', location: m.location || '', isMissed: true, rawDate: ''
              }))
              const fhirAppts = apptData || []
              const combined = [...fhirAppts, ...aiMissed]
              const deduped = []
              const seen = new Set()
              for (const a of combined) {
                const dateKey = a.date?.replace(/\s+/g, '') || ''
                const locKey = (a.location || '').toLowerCase().trim()
                const key = `${dateKey}|${locKey}`
                if (!seen.has(key)) { seen.add(key); deduped.push(a) }
              }
              deduped.sort((a, b) => {
                const order = { upcoming: 0, missed: 1, completed: 2, stopped: 3 }
                const oa = order[a.status] ?? 9, ob = order[b.status] ?? 9
                if (oa !== ob) return oa - ob
                return (b.rawDate || '').localeCompare(a.rawDate || '')
              })
              const ITEMS = 10
              const totalPages = Math.ceil(deduped.length / ITEMS)
              const paged = deduped.slice((apptPageNum - 1) * ITEMS, apptPageNum * ITEMS)
              return (
                <>
                  {paged.map((a, i) => (
                    <div key={i} className="dash-appt-row">
                      <div className="dash-appt-info">
                        <div className="dash-appt-title">
                          <strong>{a.title}</strong>
                          {a.isMissed
                            ? <span className="dash-pill pill-missed">Missed</span>
                            : <span className={`dash-pill pill-${a.status}`}>{a.status === 'upcoming' ? 'Upcoming' : a.status === 'completed' ? 'Completed' : a.status === 'stopped' ? 'Stopped' : a.status}</span>
                          }
                        </div>
                        {a.with && <p>{a.isMissed ? a.with : `with ${a.with}`}</p>}
                        <p className="dash-appt-meta">
                          {a.date && <><img src="/images/icon-calendar.png" alt="" className="dash-banner-icon" /> {a.date}</>}
                          {a.time && <>&nbsp; <svg viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" width="14" height="14" style={{verticalAlign:'middle',marginRight:2}}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>{a.time}</>}
                          {a.endDate && <>&nbsp; → &nbsp;<img src="/images/icon-calendar.png" alt="" className="dash-banner-icon" /> {a.endDate}</>}
                          {a.endTime && <>&nbsp; <svg viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" width="14" height="14" style={{verticalAlign:'middle',marginRight:2}}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>{a.endTime}</>}
                          {a.location && <>&nbsp; 📍 {a.location}</>}
                        </p>
                      </div>
                    </div>
                  ))}
                  {totalPages > 1 && (
                    <div className="cn-pagination">
                      {apptPageNum > 1 && <button className="cn-page-btn" onClick={() => setApptPageNum(p => p - 1)}>‹ Prev</button>}
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map(pg => (
                        <button key={pg} className={`cn-page-btn ${apptPageNum === pg ? 'cn-page-active' : ''}`} onClick={() => setApptPageNum(pg)}>{pg}</button>
                      ))}
                      {apptPageNum < totalPages && <button className="cn-page-btn" onClick={() => setApptPageNum(p => p + 1)}>Next ›</button>}
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        </div>

        {/* ─ Right Sidebar ─ */}
        <div className="dash-col-side">
          {/* Care Team */}
          <div className="dash-card">
            <div className="dash-card-head">
              <h3>👥 Care Team</h3>
              <p>{(careTeamData || d.careTeam).length} MEMBERS INVOLVED</p>
            </div>
            {(careTeamData || d.careTeam).map((c, i) => (
              <div key={i} className="dash-team-row">
                <div className="dash-team-avatar">{c.initials}</div>
                <div className="dash-team-info">
                  <div className="dash-team-name">{c.name}</div>
                  <p className="dash-team-dept">{c.program || c.dept || c.role || 'Care Coordinator'}</p>
                </div>
                <div className="dash-team-actions">
                  <button title="Call">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                  </button>
                  <a href={c.email ? `mailto:${c.email}` : '#'} title={c.email || 'No email available'} className="dash-team-email-link">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  </a>
                </div>
              </div>
            ))}
          </div>

          {/* Clinical Notes */}
          <div className="dash-card">
            <div className="dash-card-head">
              <div>
                <h3>Clinical Notes</h3>
                <p>{totalNotesCount} TOTAL ENTRIES</p>
              </div>
              
            </div>
            <div className="dash-note-filters">
              {[
                { key: 'clinical', label: `Clinic (${clinicNotes.length})` },
                { key: 'coordination', label: `Care (${careNotes.length})` },
                { key: 'admin', label: `Admin (${adminNotes.length})` },
              ].map(f => (
                <button key={f.key} className={`dash-note-filter ${noteFilter === f.key ? 'active' : ''}`} onClick={() => { setNoteFilter(f.key); setNotePage(1) }}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="cn-notes-list">
              {paginatedNotes.map((n, i) => (
                <div key={i} className="dash-note-row">
                  <div className="dash-note-header">
                    <div className="dash-note-header-left">
                      <div className="dash-note-avatar">{n.initials}</div>
                      <div className="dash-note-author">
                        <strong>{n.author}</strong>
                        <p>{n.role}</p>
                      </div>
                    </div>
                    <div className="dash-note-tags">
                      <span className={`dash-pill pill-note-${(n.type || 'clinical').toLowerCase()}`}>{n.type || 'Clinical'}</span>
                      <span className="dash-note-view" onClick={() => setViewingNote(n)}>View</span>
                    </div>
                  </div>
                  {n.taskTitle ? (
                    <div className="dash-note-task-info">
                      <p className="dash-note-task-row"><span className="dash-note-task-label">Task:</span> {n.taskTitle}</p>
                      <p className="dash-note-task-row"><span className="dash-note-task-label">Status:</span> {n.taskStatus}</p>
                      <p className="dash-note-task-row"><span className="dash-note-task-label">Note:</span> {n.text}</p>
                    </div>
                  ) : (
                    <p className="dash-note-text">{n.text}</p>
                  )}
                  <p className="dash-note-date"><svg viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" width="13" height="13" style={{verticalAlign:'middle',marginRight:3}}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>{n.date}</p>
                </div>
              ))}
            </div>
            {totalNotePages > 1 && (
              <div className="cn-pagination">
                {notePage > 1 && <button className="cn-page-btn" onClick={() => setNotePage(p => p - 1)}>‹ Prev</button>}
                {Array.from({ length: totalNotePages }, (_, i) => i + 1).map(pg => (
                  <button key={pg} className={`cn-page-btn ${notePage === pg ? 'cn-page-active' : ''}`} onClick={() => setNotePage(pg)}>{pg}</button>
                ))}
                {notePage < totalNotePages && <button className="cn-page-btn" onClick={() => setNotePage(p => p + 1)}>Next ›</button>}
              </div>
            )}
          </div>

          

          {/* Risk Detail Modal */}
          {viewingRisk && (
            <div className="dash-modal-overlay" onClick={() => setViewingRisk(null)}>
              <div className="dash-modal ri-modal" onClick={e => e.stopPropagation()}>
                <div className="dash-modal-header">
                  <h3>{viewingRisk.name} Risk</h3>
                  <button className="dash-modal-close" onClick={() => setViewingRisk(null)}>×</button>
                </div>
                <div className="dash-modal-body" style={{ padding: '20px' }}>
                  <p className="ri-modal-title">
                    {viewingRisk.name} Risk: <span className={`ri-modal-hl ri-hl-${viewingRisk.level}`}>{viewingRisk.value} ({viewingRisk.levelLabel})</span>
                  </p>
                  <p className="ri-modal-sub">Why this risk is {(viewingRisk.levelLabel || '').toLowerCase()}:</p>
                  <div style={{ marginTop: '12px' }}>
                    <p className="ri-modal-sh">Risk Drivers</p>
                    <ul className="ri-modal-ul">
                      {viewingRisk.drivers?.length ? viewingRisk.drivers.map((d, i) => <li key={i}>{d}</li>) : <li>None identified</li>}
                    </ul>
                  </div>
                  {(viewingRisk.protective || []).length > 0 && (
                    <div style={{ marginTop: '14px' }}>
                      <p className="ri-modal-sh" style={{ color: '#16A34A' }}>Protective Factors</p>
                      <ul className="ri-modal-ul" style={{ color: '#16A34A' }}>
                        {viewingRisk.protective.map((p, i) => <li key={i}>{p}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* View Note Modal */}
          {viewingNote && (
            <div className="dash-modal-overlay" onClick={() => setViewingNote(null)}>
              <div className="dash-modal cn-modal" onClick={e => e.stopPropagation()}>
                <div className="dash-modal-header">
                  <div>
                    <h3>Clinical Note</h3>
                    <p>by {viewingNote.author}</p>
                  </div>
                  <button className="dash-modal-close" onClick={() => setViewingNote(null)}>✕</button>
                </div>
                <div className="dash-modal-body">
                  <div className="cn-view-meta">
                    <div className="dash-note-avatar" style={{ width: 40, height: 40, fontSize: 14 }}>{viewingNote.initials}</div>
                    <div>
                      <strong>{viewingNote.author}</strong>
                      <p style={{ fontSize: 12, color: '#64748B', margin: 0 }}>{viewingNote.role}</p>
                    </div>
                    <span className={`dash-pill pill-note-${(viewingNote.type || 'clinical').toLowerCase()}`}>{viewingNote.type || 'Clinical'}</span>
                  </div>
                  <p className="cn-view-text">{viewingNote.fullText || viewingNote.text}</p>
                  <p className="cn-view-date"><svg viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" width="12" height="12" style={{verticalAlign:'middle',marginRight:3}}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>{viewingNote.date}</p>
                </div>
                <div className="dash-modal-footer">
                  <button className="dash-modal-confirm" onClick={() => setViewingNote(null)}>Close</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default DashboardPage
