# Project Memory — The Time Traveller (CareBridge)

## Project Overview
- **What**: A clinical chatbot (CareBridge) that retrieves patient data from FHIR R4 APIs using Azure OpenAI function calling
- **Stack**: React (Vite) frontend, Vercel Edge Functions (api/chat.js) proxy to Azure OpenAI, FHIR R4 backend
- **FHIR Base URL**: `https://fhirassist.rsystems.com:8081`
- **GitHub**: `https://github.com/rishabh-r/platform-care-coordination.git` (branch: main)
- **Originally**: Vanilla JavaScript (app.js), converted to React without changing UI/logic

---

## Architecture

### Frontend Files
- `src/main.jsx` — React entry point
- `src/App.jsx` — Top-level component (login/home routing)
- `src/components/LoginScreen.jsx` — Login UI
- `src/components/HomeScreen.jsx` — Home screen UI
- `src/components/ChatWidget.jsx` — Core chat logic (tool execution, message rendering)
- `src/utils.js` — Markdown, Chart.js, time formatting utilities
- `src/styles.css` — All styles (unchanged from original)
- `src/config/constants.js` — Centralized constants (FHIR_BASE, etc.)
- `src/config/knowledgeBases.js` — ICD-9 codes, LOINC codes, drug codes, CPT codes, observation ranges
- `src/config/systemPrompt.js` — Full system prompt with response patterns, care gaps, clinical summary logic
- `src/config/tools.js` — 14 OpenAI function-calling tool definitions + end_chat
- `src/services/auth.js` — Login/authentication
- `src/services/fhir.js` — FHIR API calls and `executeTool()` with all 14 tool cases
- `src/services/openai.js` — Azure OpenAI streaming API communication
- `api/chat.js` — Vercel Edge function proxy to Azure OpenAI

### Key Config Files
- `vite.config.js` — Vite config
- `vercel.json` — Vercel deployment config
- `package.json` — React dependencies

---

## All 14 FHIR APIs Integrated

| # | Tool Name | API Endpoint | Key Params |
|---|-----------|-------------|------------|
| 1 | search_fhir_patient | /baseR4/Patient | GIVEN, FAMILY, EMAIL, GENDER, BIRTHDATE, PATIENT_ID |
| 2 | search_patient_condition | /baseR4/Condition | PATIENT, CODE (ICD-9), page |
| 3 | search_patient_procedure | /baseR4/Procedure | PATIENT, CODE (CPT), page |
| 4 | search_patient_medications | /baseR4/MedicationRequest | PATIENT, DRUG_CODE, STATUS, page |
| 5 | search_patient_encounter | /baseR4/Encounter | PATIENT, STATUS, CLASS (IMP/AMB), DATE, DATE2, page |
| 6 | search_patient_observations | /baseR4/Observation/search | PATIENT, CODE (LOINC), CATEGORY, VALUE_QUANTITY, DATE, page |
| 7 | search_patient_service_request | /baseR4/ServiceRequest | PATIENT, _ID, page |
| 8 | search_patient_document_reference | /baseR4/DocumentReference | PATIENT, _ID, page |
| 9 | search_patient_diagnostic_report | /baseR4/DiagnosticReport | PATIENT, _ID, page |
| 10 | search_patient_episode_of_care | /baseR4/EpisodeOfCare | PATIENT, STATUS, TYPE, _ID, page |
| 11 | search_practitioner | /baseR4/Practitioner | NAME, SPECIALTY, _ID, page |
| 12 | search_patient_allergy | /baseR4/AllergyIntolerance | PATIENT, _ID, page |
| 13 | search_patient_appointment | /baseR4/Appointment | PATIENT, STATUS, _ID, page |
| 14 | search_patient_immunization | /baseR4/Immunization | PATIENT, _ID, page |

All APIs use `page=0` + `size=100` (fetch all results in one call — no multi-page pagination needed).

---

## Database Schema (DESIGN_DOCUMENT.pdf)

The backend database follows the schema defined in `DESIGN_DOCUMENT.pdf` (located at `D:\new api integration\DESIGN_DOCUMENT.pdf`).

### Key Schema Changes from v1 to v2
- **UUIDs** as primary keys (not numeric IDs)
- **Unified `encounter` table** — replaces old `Visit_Admission` + `Visit_Outpatient`
- **Audit columns** on every table: `version`, `created_at`, `updated_at`
- **Master table FK pattern** — conditions, observations, procedures reference master tables via FK IDs
- **New tables**: `organization`, `patient_identifier`, `medication_code_master`, `episode_of_care` (+ sub-tables)
- Patient IDs are UUIDs (system prompt and tools updated accordingly)

### Master Tables (already exist in database)
- **Condition_Master** — 14,567 rows, columns: `row_id`, `icd9_code`, `short_title`, `long_title`, `category`, `cat_code`
- **Measurement_Master** — 773 rows, columns: `row_id`, `itemid`, `label`, `fluid`, `category`, `loinc_code`
- **Procedure_Master** — 134 rows, columns: `row_id`, `category`, `sectionrange`, `sectionheader`, `subsectionrange`, `subsectionheader`, `codesuffix`, `mincodeinsubsection`, `maxcodeinsubsection`

### FK Chain for Observations (critical to understand)
```
observation.observation_code_id → Measurement_Master.row_id → Measurement_Master.loinc_code
```
Bot passes LOINC code → backend searches Measurement_Master for loinc_code → gets row_id → searches observation table by observation_code_id.

### Design Document Table Details (from PDF analysis)
Each table in the PDF follows this pattern: UUID primary key `id`, entity-specific columns, and audit columns (`version`, `created_at`, `updated_at`).

**Tables defined in DESIGN_DOCUMENT.pdf:**
| Table | Key Columns | Notes |
|-------|-------------|-------|
| organization | id, name, type_code, type_display, active, address_*, telecom_* | Healthcare organizations |
| practitioner | id, active, family, given, prefix, gender, birth_date, qualification_code, qualification_display, specialty_code, specialty_display, organization_id, telecom_* | Doctors + care coordinators |
| patient | id, active, gender, birth_date, deceased_flag, deceased_date, marital_status_code/display, language_code/display, primary_practitioner_id (FK→practitioner), managing_organization_id (FK→organization) | Core patient demographics |
| patient_identifier | id, patient_id (FK→patient), system, value, type_code | MRN, SSN, etc. |
| patient_name | id, patient_id (FK→patient), use_type, family, given_first, given_middle, prefix, suffix, period_start/end | Official/nickname |
| patient_address | id, patient_id (FK→patient), use_type, type, line1, line2, city, state, postal_code, country, period_start/end | Home/work address |
| patient_telecom | id, patient_id (FK→patient), system, value, use_type, rank | Phone/email/fax |
| encounter | id, status, encounter_class (IMP/AMB/EMER), type_code/display, patient_id (FK), practitioner_id (FK), period_start/end, admission_location, discharge_location, discharge_disposition_code, reason_code/display, diagnosis_text, insurance, clinical_notes | Unified inpatient+outpatient |
| condition | id, patient_id (FK), encounter_id (FK), recorder_id (FK→practitioner), condition_code_id (FK→Condition_Master), clinical_status, verification_status, severity_code/display, seq_num, onset_date, abatement_date, recorded_date | Diagnoses |
| observation | id, patient_id (FK), encounter_id (FK), performer_id (FK→practitioner), observation_code_id (FK→Measurement_Master), status, value_quantity, value_unit, value_string, interpretation_code, effective_date, issued | Labs/vitals |
| procedure | id, patient_id (FK), encounter_id (FK), performer_id (FK→practitioner), procedure_code_id (FK→Procedure_Master), cpt_code, status, description, performed_start/end, body_site_code/display, outcome_code | Surgeries/procedures |
| medication_code_master | id, code_system, code_value, code_display, generic_name, form_code, form_display, active | Drug catalog (new table) |
| medication_request | id, patient_id (FK), encounter_id (FK), requester_id (FK→practitioner), medication_code_id (FK→medication_code_master), status, intent, priority, dosage_text, dosage_route_code/display, dose_value/unit, frequency_text, reason_code/display, note, authored_on, valid_start/end | Prescriptions |
| appointment | id, patient_id (FK), practitioner_id (FK), status, type_code/display, reason_code/display, description, start_time, end_time, minutes_duration, location, clinical_notes | Scheduled visits |
| allergy_intolerance | id, patient_id (FK), recorder_id (FK→practitioner), clinical_status, verification_status, type, category, criticality, code_value, code_display, reaction_substance, reaction_manifestation, reaction_severity, onset_date, recorded_date, note | Allergies |
| diagnostic_report | id, patient_id (FK), encounter_id (FK), performer_id (FK→practitioner), status, category_code/display, code_value/display, effective_date, issued, conclusion | Lab/imaging reports |
| diagnostic_report_observation | id, diagnostic_report_id (FK→diagnostic_report), observation_id (FK→observation) | Links reports to observations |
| service_request | id, patient_id (FK), encounter_id (FK), requester_id (FK→practitioner), status, intent, priority, code_value/display, reason_code/display, note, authored_on | Referrals/orders |
| immunization | id, patient_id (FK), encounter_id (FK), performer_id (FK→practitioner), status, vaccine_code/display, occurrence_date, lot_number, site_code/display, dose_quantity/unit, note | Vaccinations |
| document_reference | id, patient_id (FK), encounter_id (FK), author_id (FK→practitioner), status, type_code/display, category_code/display, description, content_type, content_url, content_title, date_created | Clinical documents |
| episode_of_care | id, patient_id (FK), managing_organization_id (FK), care_manager_id (FK→practitioner), type_code/display, status, period_start/end | Care programs |
| episode_of_care_diagnosis | id, episode_of_care_id (FK), condition_id (FK→condition), role_code/display, rank | Linked diagnoses |
| episode_of_care_encounter | id, episode_of_care_id (FK), encounter_id (FK→encounter) | Linked encounters |
| episode_of_care_status_history | id, episode_of_care_id (FK), status, period_start/end | Status changes |

**Note:** EpisodeOfCare tables were NOT in the original PDF but confirmed by user via DBeaver screenshot to exist in the database. Schema was inferred from the database structure.

---

## Swagger / API Documentation
- **Swagger v3 docs endpoint**: `https://fhirassist.rsystems.com:8081/v3/api-docs`
- All APIs follow Spring Boot FHIR R4 pattern
- Pagination: Spring Boot `pageable` with `page` (0-indexed) and `size` params
- Auth: Bearer token in Authorization header
- Response format: FHIR R4 Bundle with `entry[].resource` pattern

---

## User's Data Creation Instructions (Story Rules)

These are the rules the user specified for creating patient test data. Follow these for ALL future patients:

1. **Time span**: 3 years of clinical history (e.g., March 2023 — March 2026)
2. **Encounters**: Mix of inpatient (IMP) and outpatient (AMB) — Patient 1 has 20, Patient 2 should have 25
3. **Genuine data**: All diagnoses, diagnosis codes, clinical notes must look realistic. Don't copy from master tables — think of genuine diagnoses yourself
4. **Clinical notes**: Keep very short
5. **Observations**: Pick 7 genuine lab types relevant to the patient's disease from Measurement_Master. Same observation can repeat across encounters but must have 7 unique types
6. **Conditions**: For each encounter, assign conditions with seq_num. seq_num=1 is primary, seq_num=2 is secondary. Keep seq_num=2 rare (most encounters just seq_num=1)
7. **Procedures**: Only for inpatient (hadm_id). Look up CPT codes from Procedure_Master. Max 2 procedures per encounter. Different times for chartdate
8. **Medications**: Max 2 medications per encounter. Think yourself what's best for the patient's condition. Keep is_active=1 for active
9. **Date formats**: Follow the format used in existing data
10. **Care gaps MUST be simulated**:
    - **Medication non-adherence**: Set status="stopped", add note with "Care gap", "self-discontinued", "stopped by patient", "did not inform care team"
    - **Missed follow-up appointments**: Set encounter status="cancelled", add clinical_notes with "No-show" details
11. **Story-based**: Each patient should have a coherent clinical story (disease progression, complications, treatments)
12. **All APIs must have data**: No API should be left without backing data — every API must return results for the patient
13. **UUIDs**: All primary keys are UUIDs
14. **FK references**: Use correct FK IDs from master tables (Condition_Master, Measurement_Master, Procedure_Master)
15. **Episodes of Care**: Include care coordinators (not doctors — nurses/case managers who manage care programs)
16. **Knowledge base**: After creating patient data, ensure all codes used (ICD, LOINC, CPT, drug codes) are present in knowledgeBases.js

### Patient Plans
- **Patient 1**: Male, Type 2 Diabetes with complications, 20 encounters — COMPLETED (James Robert Mitchell)
- **Patient 2**: Female, CHF (Congestive Heart Failure), 25 encounters — PENDING

---

## Excel File: chatbase_data.xlsx

### Current State: 27 sheets

**3 Master/Lookup Tables (kept for FK reference when creating future patients):**
1. Measurement_Master (773 rows)
2. Condition_Master (14,567 rows)
3. Procedure_Master (134 rows)

**24 New Schema Sheets (Patient 1 data):**
4. organization
5. practitioner (includes 4 care coordinators)
6. patient
7. patient_identifier
8. patient_name
9. patient_address
10. patient_telecom
11. encounter (20 entries — mix of IMP and AMB)
12. condition
13. observation (74 rows, 7 unique observation types)
14. procedure
15. medication_code_master (11 medications)
16. medication_request (12 entries)
17. appointment
18. allergy_intolerance
19. diagnostic_report
20. diagnostic_report_observation
21. service_request
22. immunization
23. document_reference
24. episode_of_care
25. episode_of_care_diagnosis
26. episode_of_care_encounter
27. episode_of_care_status_history

### Deleted Old Sheets (no longer needed)
Person, Person_name, Person_Address, Person_Language, Person_Telecom, Extensions, Person_Measurement, Person_condition, Visit_Admission, Visit_Outpatient, Person_Procedure, Prescription — these were old v1 schema patient-specific data for 100+ patients.

---

## Patient 1 — James Robert Mitchell

- **Patient UUID**: `a3f8b2c1-7d4e-4a91-b6e5-9c2d1f3e8a7b`
- **DOB**: 15-Jun-1978
- **Gender**: Male
- **Marital Status**: Married
- **Language**: English
- **Primary Disease**: Type 2 Diabetes Mellitus with complications
- **Primary Practitioner**: Dr. Chen (UUID: `b2c7d4e1-8f3a-4b5c-9d6e-1a2b3c4d5e6f`)
- **Managing Organization**: Endocrinology Associates (UUID: `f6a1b8c5-2d7e-8f9a-3b0c-5e6f7a8b9c0d`)
- **Time Span**: March 2023 — March 2026 (3 years)
- **Encounters**: 20 total (mix of inpatient IMP and outpatient AMB)

### Conditions (ICD-9 codes used)
- 25000 — DMII wo cmp (condition_code_id: 1591)
- 25002 — DMII wo cmp uncntrld (1593)
- 25012 — DMII ketoacd uncontrold (1597)
- 25062 — DMII neuro uncntrld (2265)
- 2510 — Hypoglycemic coma (2279)
- 2724 — Hyperlipidemia NEC/NOS (2747)
- 4019 — Hypertension NOS (4304)
- 6826 — Cellulitis of leg (7283)

### Observations (7 unique types, LOINC codes)
| observation_code_id | Label | LOINC | In Knowledge Base |
|---|---|---|---|
| 53 | Hemoglobin A1c | 4548-4 | ✓ |
| 113 | Creatinine | 2160-0 | ✓ |
| 132 | Glucose | 2345-7 | ✓ |
| 172 | Potassium | 2823-3 | ✓ |
| 200 | Triglycerides | 1644-4 | ✓ |
| 106 | Cholesterol LDL | 2090-9 | ✓ |
| 108 | Cholesterol Total | 2093-3 | ✓ |

### Procedures (CPT codes used)
99222, 82947, 96365, 80053, 96360, 11042, 99232, 99254 — all in knowledge base.

### Medications (medication_code_master IDs)
1=Metformin 500mg, 2=Metformin 1000mg, 3=Aspirin 81mg, 4=Lisinopril 10mg, 5=Insulin Regular, 6=NS 0.9%, 7=Insulin Glargine, 8=Atorvastatin 20mg, 9=Dextrose 50%, 10=Cephalexin 500mg, 11=Gabapentin 300mg

### Care Gaps Simulated
- **Medication non-adherence**: Aspirin self-discontinued (status=stopped, note contains "Care gap — patient self-discontinued")
- **Missed appointments**: Encounters with status=cancelled and clinical_notes containing "No-show"

### Episodes of Care (4 programs)
- Diabetes Disease Management (active)
- Diabetic Neuropathy Pain Management (active)
- Hypertension Monitoring (active)
- Diabetic Foot Care (finished)

### Care Coordinators (added to practitioner sheet)
- Rebecca Torres, RN — Diabetes Care Coordinator
- Maria Santos, RN — Neuropathy Care Coordinator
- David Park, RN — Hypertension Care Coordinator
- Jennifer Walsh, RN — Wound Care Coordinator

---

## Patient 2 — Sarah Elizabeth Cooper

- **Patient UUID**: `a3e838d7-a0dc-41af-859b-113c9dc93ea9`
- **DOB**: 20-Feb-1955
- **Gender**: Female
- **Marital Status**: Married
- **Language**: English
- **Primary Disease**: Congestive Heart Failure (CHF) with AFib, HTN, CKD
- **Primary Practitioner**: Dr. Anita Patel (UUID in practitioner sheet, Cardiology)
- **Managing Organization**: Raleigh Heart & Vascular Center (UUID in organization sheet)
- **Time Span**: March 2023 — March 2026 (3 years)
- **Encounters**: 25 total (6 IMP + 17 AMB + 2 cancelled no-shows)
- **Excel background**: All Patient 2 rows have **yellow background** (`#FFFF99`)

### Clinical Story
- Mar 2023: Initial CHF diagnosis (LVEF 38%), started Furosemide + Lisinopril
- Jun 2023: First acute decompensation (IMP), IV diuretics, 3-day admission
- Sep 2023: AFib detected, started Warfarin, discontinued Aspirin
- Oct 2023: AFib with RVR (HR 142), cardioversion (IMP)
- Feb 2024: Missed appointment (CARE GAP — no-show)
- May 2024: CHF exacerbation — patient self-discontinued Furosemide (CARE GAP — medication non-adherence)
- Jun 2024: Post-discharge, restarted Furosemide, added Spironolactone + KCl
- Aug 2024: CKD Stage 3 diagnosed (cardiorenal syndrome), Creatinine 1.5
- Oct 2024: Fluid overload with pleural effusions (IMP), Digoxin added
- Dec 2024: Missed appointment (CARE GAP — no-show)
- Feb 2025: Severe CHF exacerbation, ICU admission (LVEF 25%), IV Milrinone
- Mar 2025: Switched Lisinopril → Entresto (Sacubitril-Valsartan)
- Jul 2025: Elective cardiac catheterization — moderate non-obstructive CAD, no intervention
- Oct 2025: Clinically improved, NYHA Class II, cardiac rehab completing
- Mar 2026: Latest visit — stable, LVEF 38%, NT-proBNP 380 (near normal)

### Conditions (ICD-10 codes, condition_code_id from Condition_Master)
- 4473 — CHF NOS (I50814)
- 4477 — Chr systolic hrt failure (I5022)
- 4481 — Chr diastolic hrt fail (I5032)
- 4476 — Acute systolic hrt failure (I5021)
- 4478 — Ac on chr syst hrt fail (I5023)
- 4462 — Atrial fibrillation (I4891)
- 14618 — Paroxysmal AFib (I48.0)
- 4304 — Hypertension NOS (I10)
- 14590 — CKD stage 3 (N18.3)
- 14617 — T2DM without complications (E11.9)
- 5273 — Acute lung edema (J810)
- 12123 — Edema (R600)
- 5149 — Pleural effusion (J90)
- 2745 — Mixed hyperlipidemia (E782)

### Observations (9 unique types including vitals)
| observation_code_id | Label | LOINC | Unit | In Knowledge Base |
|---|---|---|---|---|
| 1 | Heart Rate | 8867-4 | /min | ✓ |
| 2 | Systolic Blood Pressure | 8480-6 | mmHg | ✓ |
| 3 | Diastolic Blood Pressure | 8462-4 | mmHg | ✓ |
| 4 | Body Temperature | 8310-5 | degC | ✓ |
| 10 | Glucose | 2345-7 | mg/dL | ✓ |
| 11 | Creatinine | 2160-0 | mg/dL | ✓ |
| 17 | NT-proBNP | 33762-6 | pg/mL | ✓ |
| 24 | Potassium | 2823-3 | mEq/L | ✓ |
| 25 | Sodium | 2951-2 | mEq/L | ✓ |

Total: 147 observations across 23 non-cancelled encounters.

### Procedures (CPT codes)
93000, 93010, 93303, 93306, 99222, 99223, 99254, 99291 — all in knowledge base.
12 procedures across 6 inpatient encounters (max 2 per encounter).

### Medications (medication_code_master IDs)
New: 249=Furosemide 40mg, 250=Metoprolol Succinate ER 25mg, 251=Digoxin 0.125mg, 252=Spironolactone 25mg
Existing reused: 3=Aspirin 81mg, 4=Lisinopril 10mg, 24=Sacubitril-Valsartan 97-103mg, 26=Warfarin 5mg, 155=KCl 20mEq

### Care Gaps Simulated
- **Medication non-adherence**: Furosemide self-discontinued (status=stopped, note contains "Care gap — patient self-discontinued furosemide due to frequent urination")
- **Missed appointments**: Encounter 9 (Feb 2024) and Encounter 16 (Dec 2024) both status=cancelled with "No-show" clinical notes

### Episodes of Care (4 programs)
- CHF Disease Management Program (active) — Care Coordinator: Lisa Martinez, RN
- Atrial Fibrillation Monitoring Program (active) — Care Coordinator: Angela Johnson, RN
- Chronic Kidney Disease Monitoring (active) — Care Coordinator: Patricia Williams, RN
- Cardiac Rehabilitation Program (finished) — Care Coordinator: Karen Anderson, RN

### Other Data
- **Allergies**: 3 (Iodine contrast dye, Shellfish, NSAID intolerance)
- **Diagnostic Reports**: 5 (Echo, CMP, ECG, Cardiac Cath, NT-proBNP Trend)
- **Service Requests**: 5 (Echo, Pulmonology consult, Nephrology consult, Cardiac cath, Cardiac rehab)
- **Immunizations**: 6 (Influenza x3, Pneumococcal PCV20, COVID-19 booster, Td)
- **Document References**: 6 (5 discharge summaries + 1 cardiac cath procedure note)

### Testing Prompts for Patient 2
1. "Search for patient Sarah Cooper"
2. "What are the active conditions for this patient?"
3. "Show me all inpatient admissions for this patient"
4. "What is the latest NT-proBNP for this patient?"
5. "Show recent observations for this patient"
6. "List all medications for this patient"
7. "Perform a care gap analysis for this patient"
8. "Show appointments for this patient"
9. "Does this patient have any allergies?"
10. "What vaccines has this patient received?"
11. "Show episodes of care for this patient"
12. "Who are the care coordinators for this patient?"
13. "Show diagnostic reports for this patient"
14. "Find Dr. Patel"
15. "Give me a full clinical summary of this patient"
16. "Show me the NT-proBNP trend as a chart"
17. "Show blood pressure trends for this patient"
18. "Show heart rate trends for this patient"

---

## Data Generation Scripts (in project root, not committed to git)
- `generate_patient1.py` — First version (superseded)
- `generate_patient1_v2.py` — Patient 1 data per DESIGN_DOCUMENT.pdf schema
- `generate_episode_of_care.py` — Added EpisodeOfCare sheets + care coordinators
- `cleanup_sheets.py` — Deleted old patient-specific sheets
- `check_codes.py` — Verified FK code mappings
- `check_old_sheets.py` — Analyzed old sheets before deletion
- `fix_units.py` — Added missing expected_unit values to Measurement_Master (335 units filled)
- `generate_patient2.py` — Patient 2 (Sarah Cooper) CHF data, all 24 sheets with yellow background

---

## Knowledge Bases (src/config/knowledgeBases.js)
- **CONDITION_CODES** — ICD-9 + ICD-10 codes (all Patient 1 and Patient 2 codes included)
- **LOINC_CODES** — 68 LOINC codes with units (all Patient 1 and Patient 2 observations included)
- **DRUG_CODES** — Drug formulary codes including INSR, ENTR49/97, SACV49/97 (all Patient 1 and Patient 2 drugs covered)
- **PROCEDURE_CODES** — CPT code ranges + specific codes including 93000, 93010, 93303 (all Patient 1 and Patient 2 procedures included)
- **OBSERVATION_RANGES** — Normal ranges with Low/Normal/High classifications (includes BP, HR, temp, glucose, NTproBNP, sodium, potassium, creatinine)

---

## System Prompt Key Features (src/config/systemPrompt.js)
- Response patterns for all 14 APIs — NO API pagination (all results returned in single call with size=100)
- **Display chunking (conditions only)**: Conditions API shows 15 at a time from the same API response (no new API call). User says "more" → next batch from same data. Other APIs show all results at once
- Explicit instruction to display every entry individually even if ICD/LOINC codes repeat (each is tied to different encounter/date)
- Care gap analysis (missed follow-ups, clinical deterioration, medication non-adherence)
- Clinical summary (fetches all APIs simultaneously)
- Discharge summary
- Chart support ([CHART:{...}] format)
- EpisodeOfCare care coordinator pattern (answers "who is taking care of this patient?")
- Cross-patient search by code (conditions, medications, procedures, observations)

---

## Testing Prompts for Patient 1
1. "Search for patient James Mitchell"
2. "What are the active conditions for this patient?"
3. "Show me all inpatient admissions for this patient"
4. "What is the latest HbA1c for this patient?"
5. "Show recent observations for this patient"
6. "List all medications for this patient"
7. "Perform a care gap analysis for this patient"
8. "Show appointments for this patient"
9. "Does this patient have any allergies?"
10. "What vaccines has this patient received?"
11. "Show episodes of care for this patient"
12. "Who are the care coordinators for this patient?"
13. "Show service requests for this patient"
14. "Show diagnostic reports for this patient"
15. "Show clinical documents for this patient"
16. "Find Dr. Chen"
17. "Give me a full clinical summary of this patient"
18. "Show me the HbA1c trend as a chart"

---

## Debugging Approach
When testing, if issues arise:
1. Hit the API in Postman and copy the curl + response
2. Copy the chatbot's response
3. Share both — this allows comparison of raw API data vs bot interpretation

---

## Git Commands (PowerShell)

**Note: This is a PowerShell environment — `&&` does NOT work. Run commands one by one.**

```powershell
# Check status
git status

# Stage specific files (exclude Excel, Python scripts)
git add src/config/systemPrompt.js src/config/tools.js src/config/knowledgeBases.js

# Stage all code changes (be selective, don't include .xlsx or .py data scripts)
git add src/

# Commit
git commit -m "Your commit message here"

# Push to GitHub
git push origin main

# Check recent commits
git log --oneline -5

# Check what changed
git diff --stat

# Check remote
git remote -v
```

**Files to NEVER commit**: `chatbase_data.xlsx`, `generate_*.py`, `check_*.py`, `cleanup_sheets.py`, `~$chatbase_data.xlsx`, `.env`

---

## Care Gap Dashboard (CareCord AI)

### Overview
After a care gap analysis, the chatbot shows a "Launch CareCord AI" button that opens a dynamic dashboard page at `/dashboard?patient={patientId}`. The dashboard displays AI-structured care gap insights, patient data, and an action approval workflow.

### Old Implementation Reference
The full working implementation exists at `D:\Fresh FHIR\the-time-traveller-main` with these key files:
- `src/components/DashboardPage.jsx` (966 lines) — Full dashboard component
- `src/dashboard.css` (23,628 bytes) — Full dashboard styling
- `src/App.jsx` — React Router setup with `/` and `/dashboard` routes
- `src/components/ChatWidget.jsx` — CareCordButton component + sessionStorage caching

### Flow
1. **ChatWidget.jsx** — When user asks a care gap question:
   - Detects "care gap" in user message
   - Stores bot's care gap response in `sessionStorage` key: `dashboard_caregap_{patientId}`
   - Shows "Launch CareCord AI" button with dynamic URL: `/dashboard?patient={patientId}`

2. **App.jsx** — Uses `react-router-dom` with `BrowserRouter`:
   - `/` → MainApp (login + home + chat)
   - `/dashboard` → DashboardPage

3. **DashboardPage.jsx** — Reads `patient` from URL query params, then:
   - Fetches patient details from FHIR: `/baseR4/Patient/{patientId}`
   - Fetches medications + encounters from FHIR directly
   - Reads cached care gap text from `sessionStorage`
   - Sends care gap text to a **second AI call** (`callAIForAnalysis`) via `/api/chat` endpoint
   - AI extracts structured JSON with: `alerts`, `trends`, `aiActions`, `missedAppointments`
   - If no cached text, falls back to fetching FHIR data directly and summarizing
   - Falls back to `MOCK_DATA` for sections without live data (vitals, care team, clinical notes, risk insights)

### AI Analysis Prompt (callAIForAnalysis)
The dashboard sends the care gap text to AI with a system prompt that extracts:
```json
{
  "alerts": [{ "title": "...", "detail": "...", "severity": "CRITICAL|HIGH|MEDIUM" }],
  "trends": [{ "label": "SHORT_LABEL", "value": "value with units", "status": "critical|high|medium" }],
  "aiActions": [{ "title": "...", "priority": "High|Medium|Low Priority", "timeframe": "Within 24 hours|48 hours|1 week", "description": "...", "rationale": "..." }],
  "missedAppointments": [{ "title": "...", "date": "...", "location": "...", "reason": "..." }]
}
```
- Always returns exactly 3 alerts: Clinical Deterioration, Medication Non-Adherence, Missed Follow-Up
- Trends: all abnormal/deteriorating observations with values and status
- AI Actions: 4-6 recommended actions with priority, timeframe, description, rationale
- Missed Appointments: all no-shows/cancellations extracted from care gap text

### Dashboard UI Sections
1. **Navbar** — Logo, "Patient 360 Portal" title, nav links (Care Manager/Provider/Patients), notifications bell, user info
2. **Sub-header** — Back button, breadcrumb, quick-scroll pills (Vitals/Medications/Appointments)
3. **Patient Banner** — Avatar with initials, name, High Priority pill, Care Gap pill, age/gender/MRN/programs, DOB/phone/email, "Mark as Reviewed" button
4. **Alert Triggers & Risk Drivers** — 3 alert cards (Clinical Deterioration ⚠, Medication Non-Adherence 💊, Missed Appointments 📅) with severity pills + Deteriorating Clinical Trends chips
5. **Risk Insights** — AI-powered risk percentages (static/mock)
6. **Tabs** — AI Actions (active), Clinical Trends, Task Queue, Patient Outreach (disabled)
7. **AI-Recommended Actions** — Checkbox-selectable action cards with priority pills, timeframe, description, AI rationale. "Approve Selected" button opens modal
8. **Approval Modal** — Lists selected actions, coordinator notes textarea, "Confirm & Create Tasks" button
9. **Vitals** — Grid cards with icons, values, normal ranges, status bars (mock data)
10. **Medications** — List from FHIR with name, dose, frequency, status pills (Active/Discontinued/On-hold), show more/less
11. **Appointments & Encounters** — From FHIR + AI-extracted missed appointments, with status pills (Upcoming/Completed/Missed), show more/less
12. **Right Sidebar — Care Team** — Team members with avatars, roles, departments, call/email buttons (mock data)
13. **Right Sidebar — Clinical Notes** — Filterable notes (All/Clinical/Coordination) with author, role, text, date (mock data)

### Adaptation Needed for Current Codebase
- Add `react-router-dom` dependency
- Change API params from `subject` to `patient` (v2 API)
- Copy `DashboardPage.jsx` and adapt for v2 APIs
- Copy `dashboard.css`
- Update `App.jsx` with Router + `/dashboard` route
- Update `ChatWidget.jsx` with `CareCordButton` component + sessionStorage caching (replace static Figma URL)
- Update `vercel.json` for SPA routing (rewrites for `/dashboard`)

### Current State — IMPLEMENTED
- **Old codebase reference**: `D:\Fresh FHIR\the-time-traveller-main`
- **Current codebase**: Dynamic dashboard fully ported and adapted for v2 APIs
- **Status**: COMPLETED — all changes done, build passes clean

### Files Added/Changed for Dashboard
- `package.json` — Added `react-router-dom`
- `src/App.jsx` — Added `BrowserRouter` with `/` and `/dashboard` routes, imports `formatDisplayName` from utils
- `src/utils.js` — Added `formatDisplayName` (shared between App and Dashboard)
- `src/components/ChatWidget.jsx` — Care gap response cached in `sessionStorage` (`dashboard_caregap_{patientId}`), static Figma URL replaced with dynamic `/dashboard?patient={patientId}`
- `src/components/DashboardPage.jsx` — Ported from old codebase, adapted: `subject` → `patient`, `/Observations` → `/Observation/search`, import `FHIR_BASE` from `../config/constants`
- `src/dashboard.css` — Copied from old codebase (full dashboard styling)
- `public/images/LogoRsi.png` — Dashboard logo (copied from old codebase)
- `vercel.json` — Added SPA rewrite: `{ "source": "/((?!api/).*)", "destination": "/index.html" }`

---

## Known Issues / Bugs Found During Testing

### 1. Pagination Overlap — Size 20 → 100 Fix (FIXED)
- **Problem**: Backend pagination is non-standard. The `page` param always steps by a fixed offset of 10, regardless of `size`. So `page=0&size=20` returns results 1–20, but `page=1&size=20` returns results 11–30 (overlapping with results 11–20 from page 0). This caused the LLM to receive duplicate entries and display fewer unique conditions (17 shown out of 21 total).
- **Root cause**: Backend uses `offset = page × 10` (fixed step of 10), not standard `offset = page × size`.
- **How pagination actually works**:
  - page=0, size=10 → results 1–10
  - page=0, size=20 → results 1–20
  - page=0, size=30 → results 1–30
  - page=1, size=10 → results 11–20
  - page=1, size=20 → results 11–30 (overlap!)
- **Fix applied**: Changed `size=20` to `size=100` across all 14 APIs in `src/services/fhir.js`. Since no patient will have >100 results for any single resource type, this fetches everything in one call — no pagination needed, no overlap.
- **Commit**: `c8c9e0f` — "Update API page size from 20 to 100 to fetch all results in single call"
- **Status**: FIXED and pushed to GitHub
- **System prompt update**: Removed ALL multi-page pagination instructions (page=1, page=2 etc.) from all API response patterns. All APIs now say "Display ALL results" from the single call. Conditions API only has display-side chunking (15 at a time from same data, no new API call)
- **Display pagination rule was tried globally for all APIs (15 at a time) but reverted** — only kept for conditions API since it can have many entries. Other APIs show all results at once

### 2. Observation API — Missing `code` field (BACKEND FIX NEEDED)
- **Problem**: The FHIR Observation API response is missing the `code` element entirely. Each observation has `valueQuantity`, `interpretation`, `effectiveDateTime` but NO `code` field (no LOINC code, no display name).
- **Impact**: The chatbot searches observations by LOINC code (e.g., `CODE=4548-4` for HbA1c). Since the backend has no LOINC mapping in the response, these searches return 0 results → "No data available."
- **Postman works without code param**: Searching with just `patient` + `date` returns 23 results (all observations), but they're unidentifiable without the `code` field.
- **Root cause**: Backend isn't joining `observation.observation_code_id` → `Measurement_Master.row_id` → `Measurement_Master.loinc_code` to populate the FHIR `resource.code` field.
- **Fix needed from backend team**:
  1. Join observation table with Measurement_Master to get `loinc_code` and `label`
  2. Populate `resource.code.coding[0]` with `{ system: "http://loinc.org", code: "<loinc_code>", display: "<label>" }`
  3. Support filtering by the `code` query parameter using the LOINC code
- **Status**: FIXED by backend team — `code` field now populated in API response

---

## Important Notes
- All APIs use Bearer token authentication (stored in localStorage as cb_token)
- Patient IDs are now UUIDs (not numeric)
- Backend transforms DB rows → FHIR R4 JSON responses
- The bot never queries master tables directly — it uses knowledge base codes, passes to API, backend does FK joins
- Excel file is for the backend team to insert data into the actual database
- Old master tables (Condition_Master, Measurement_Master, Procedure_Master) are kept in Excel for FK reference when creating future patient data
- **Always push code changes to GitHub** — Vercel is connected to the GitHub repo and auto-deploys on push
- Backend pagination is non-standard (page step = 10 fixed, not page × size) — we use `size=100` to avoid overlap issues
- **Shell is PowerShell** — heredoc (`<<EOF`) does NOT work; use simple `-m "message"` for git commits

---

## Dashboard Dynamic Sections (April 2, 2026)

### Changes Made to DashboardPage.jsx

#### 1. Mark as Reviewed Alert — TRIED & REVERTED
- Added a green toast "Marked for Review" for 1 second on click → user didn't like it → reverted back to simple toggle

#### 2. Care Team — Made Dynamic (DONE)
- **Before**: Static `MOCK_DATA.careTeam` with 3 hardcoded members (Dr. Michael Chen, Emily Davis, Jane Smith)
- **After**: Fetches active EpisodeOfCare records from `/baseR4/EpisodeOfCare?patient={id}&status=active`, extracts `careManager` from each episode
- **Parser**: `parseCareTeamFromEoC(bundle)` — extracts care manager name, initials, role ("Care Coordinator"), program name. Deduplicates by name
- **Fallback**: Falls back to `MOCK_DATA.careTeam` if API returns nothing
- **Shows**: Only care coordinators/managers from EpisodeOfCare, NOT practitioners/doctors
- **For Patient 1**: Rebecca Torres, Maria Santos, David Park, Jennifer Walsh — each with their care program name

#### 3. Vitals — Made Dynamic (DONE)
- **Before**: Static `MOCK_DATA.vitals` with 3 hardcoded entries (Blood Pressure, Heart Rate, Blood Glucose)
- **After**: Fetches all observations from `/baseR4/Observation/search?patient={id}&page=0&size=100`, groups by LOINC code, picks latest reading per type
- **Parser**: `parseVitalsFromFhir(bundle)` — groups observations by code, picks latest by date, maps normal ranges, classifies as normal/elevated/low, calculates status bar percentage
- **Normal ranges map**: `OBSERVATION_NORMAL_RANGES` constant with ranges for HbA1c (4.0-5.6%), Creatinine (0.6-1.3), Glucose (70-99), Potassium (3.5-5.0), Triglycerides (<150), LDL (<130), Total Cholesterol (125-200), Hemoglobin (13.0-17.5), WBC (4.5-11.0), Platelets (150-400)
- **Fallback**: Falls back to `MOCK_DATA.vitals` if API returns nothing
- **Section title**: "Vitals" (not "Latest Observations" — user preference)
- **Shows**: Each observation card with value, unit, normal range, color-coded status bar, and date of latest reading
- **For Patient 1**: 7 observation types — HbA1c 9.2%, Creatinine 1.4, Glucose 165, Potassium 4.5, Triglycerides, LDL 158, Cholesterol Total 235

#### 4. FHIR Fetches in loadDashboard — Updated
The `fhirDirectPromise` now fetches 4 resources in parallel:
1. MedicationRequest (was already there)
2. Encounter (was already there)
3. EpisodeOfCare — NEW (for Care Team)
4. Observation — NEW (for Vitals)

---

## System Prompt Changes (April 2, 2026)

### Conditions Display — 15 at a time — TRIED & REMOVED
- Tried showing conditions 15 at a time from single API call — bot was inconsistent (showed 10, then 2, then 9 instead of 15+6)
- **Removed** — conditions now show all results at once like every other API

### Clinical Deterioration Gaps — Step-by-step Instruction — TRIED & REVERTED
- **Problem**: Bot was skipping the observation API call during care gap analysis, giving vague summary instead of actual values
- Tried replacing "Refer to Section 4" with explicit step-by-step instructions (determine observations → call API → check ranges → show abnormal)
- **Reverted by user request** — user wants to handle this themselves
- **Current state**: Back to original "Refer to Section 4" instruction, but with user's simplification: removed "based on their active conditions" phrase to avoid the bot being too narrow in which observations it fetches

### User's Manual Prompt Edits (pushed to GitHub)
- Simplified Step 1 in "Recent/Latest Observations": removed "clinically relevant to the patient based on their active conditions" → just "automatically determine the key observations"
- Simplified Step 1 in "Deterioration Patterns": removed "(same approach as Section 3 above)" cross-reference
- Simplified Clinical Deterioration Gaps: removed "for this patient based on their active conditions" → just "fetch all clinically relevant observations"
- **Rationale**: The "based on active conditions" phrasing was causing the bot to be too restrictive or skip observation fetching entirely
- **Result**: Clinical deterioration gaps now working correctly after user's simplifications

---

## Additional Dashboard Fixes (April 2, 2026 — Late Session)

### Vitals Date Removed
- Removed the date display (e.g., "Oct 15, 2025") from each vitals/observation card — user didn't want it shown

### Completed Pill Color Fix
- `.pill-completed` in `dashboard.css` was red (`#FEE2E2` / `#DC2626`) — changed to green (`#DCFCE7` / `#16A34A`) to match the "Active" pill style in medications

### Current Dashboard Dynamic Sections Status
| Section | Status | Data Source |
|---------|--------|------------|
| Patient Banner | Dynamic | `/baseR4/Patient/{id}` |
| Alerts & Trends | Dynamic | AI analysis of care gap text |
| AI Actions | Dynamic | AI analysis of care gap text |
| Vitals | **Dynamic** | `/baseR4/Observation/search` — latest reading per LOINC code |
| Medications | Dynamic | `/baseR4/MedicationRequest` |
| Appointments & Encounters | Dynamic | `/baseR4/Encounter` + AI-extracted missed appointments |
| Care Team | **Dynamic** | `/baseR4/EpisodeOfCare` — care managers only |
| Risk Insights | Static | `MOCK_DATA.riskInsights` |
| Clinical Notes | Static | `MOCK_DATA.clinicalNotes` |

### Git Commits (this session, chronological)
1. `c8c9e0f` — Update API page size from 20 to 100
2. `b8beaf9` — Add notes.md with full project memory
3. `6b58bc5` — Remove all pagination from system prompt
4. `5bbd9b5` — Add 15-at-a-time display chunking (all APIs)
5. `33d237b` — Revert structured condition format
6. `da21da9` — Revert display pagination rule (all APIs)
7. `8f423be` — Add 15-at-a-time for conditions only
8. `16fff74` — Add review alert toast
9. `c0705cb` — Revert review alert, make Care Team dynamic
10. `bad8b43` — Make Vitals dynamic from Observation API
11. `d7ebaad` — Rename Latest Observations to Vitals
12. `5617d07` — Clarify clinical deterioration gaps (step-by-step)
13. `5b3708b` — Update notes.md
14. `d989b24` — Remove 15-at-a-time for conditions
15. `e6cb9e3` — User's manual prompt simplifications
16. `4561a17` — Revert clinical deterioration to original instruction
17. `18f8f3d` — User's final prompt simplification
18. `696c542` — Update notes.md
19. `86eb38b` — Remove date from vitals cards
20. `0061faf` — Fix completed pill color to green
21. `2b4b7e9` — Update notes.md
22. `26ef543` — Make Risk Insights dynamic from predict API

---

## Risk Prediction API (April 2, 2026)

### API Details
- **Endpoint**: `POST https://fhirassist.rsystems.com:5050/api/predict`
- **Body**: `{"patient_id": "<uuid>"}`
- **Header**: `Content-Type: application/json`
- **Response**: HTML page with risk data embedded as `var D={...}` in a `<script>` tag
- **No JSON endpoint available** — must parse from HTML
- **No auth required** (no Bearer token)

### Response Data Structure
The `var D` object contains risk categories as keys (e.g., `cvd`, `diabetes`, `cancer`), each with:
- `risk_level`: "High" / "Moderate" / "Low"
- `risk_percentage`: number (e.g., 82.5)
- `risk_drivers`: array of strings explaining why risk is elevated
- `protective_factors`: array of strings for positive factors

### Implementation in DashboardPage.jsx
- **Function**: `fetchRiskPrediction(patientId)` — POSTs to predict API, parses `var D={...}` from HTML via regex, maps to `{ name, value, level }` format
- **Label mapping**: `RISK_LABEL_MAP` — `cvd` → "HYPERTENSION", `diabetes` → "DIABETES", `cancer` → "CANCER"
- **Level mapping**: API returns "High"/"Moderate"/"Low" → mapped to CSS classes `high`/`mod`/`low`
- **State**: `riskData` — falls back to `MOCK_DATA.riskInsights` if API fails
- **Called in**: `loadDashboard()` alongside other FHIR fetches (runs in parallel)
- **For Patient 1**: Hypertension 63.4% (HIGH), Diabetes 82.5% (HIGH), Cancer 12.7% (LOW)

### Updated Dashboard Dynamic Sections Status
| Section | Status | Data Source |
|---------|--------|------------|
| Patient Banner | Dynamic | `/baseR4/Patient/{id}` |
| Alerts & Trends | Dynamic | AI analysis of care gap text |
| AI Actions | Dynamic | AI analysis of care gap text |
| Vitals | Dynamic | `/baseR4/Observation/search` |
| Medications | Dynamic | `/baseR4/MedicationRequest` |
| Appointments & Encounters | Dynamic | `/baseR4/Encounter` + AI missed appointments |
| Care Team | Dynamic | `/baseR4/EpisodeOfCare` — care managers |
| Risk Insights | **Dynamic** | `POST /api/predict` — risk prediction API |
| Clinical Notes | Static | `MOCK_DATA.clinicalNotes` |

### Pending Work
- **Patient 2**: COMPLETED (see Patient 2 section above)
- **Clinical Notes**: COMPLETED (see Clinical Notes section below)

---

## Session: April 3, 2026

### Patient Outreach Tab — IMPLEMENTED (Static)
- **Tab switching**: Added `activeTab` state (`'actions'` | `'outreach'`). AI Actions and Patient Outreach tabs are now clickable; Clinical Trends and Task Queue remain disabled.
- **UI matches Figma** design exactly:
  - **3 communication cards** in a row: Phone Call, SMS Message, Email Portal — each with icon, description, and green action button
  - **Outreach Communication Template** section: customizable textarea pre-filled with patient-personalized message (uses patient's first name dynamically via `pt.name`)
  - **"Send to Patient"** (red) and **"Save as Template"** (outline) buttons
- **JSX structure**: AI Actions + Approve Modal wrapped in `<>...</>` Fragment, conditionally rendered with `{activeTab === 'actions' && <>...</>}`. Patient Outreach rendered with `{activeTab === 'outreach' && (...)}`
- **Status**: Static (no API calls), functional tab switching
- **Commit**: `a2dd340` — "Add static Patient Outreach tab with phone, SMS, email cards and outreach template"

### .gitignore Updated
- Added `*.xlsx` and `*.py` to `.gitignore` to prevent Excel data files and Python scripts from being accidentally committed
- Previously committed Excel/Python files were removed from tracking with `git rm --cached`

### R Systems Logo Fix — Multiple Iterations

**Problem**: The original CSS `filter: brightness(0) invert(1)` on the logo made "SYSTEMS" text invisible. The filter turns ALL pixels white — the R icon showed as a white silhouette (visible on dark bg), but the "SYSTEMS" text (originally white on grey box) also became white (invisible against the now-white grey box).

**Iteration 1 — White background badge (REJECTED by user)**:
- Added `background: white; padding: 3px 6px; border-radius: 6px` to the logo
- Result: Full R SYSTEMS logo visible but looked odd — white box on dark background
- User feedback: "looks odd, should merge with background"

**Iteration 2 — No filter, colored logo on dark bg (APPROVED)**:
- Removed ALL filters and white background
- Logo displays as original colored image (blue R + grey SYSTEMS box with white text) directly on dark navy background
- Works because the PNG has transparency — no white rectangle behind it
- Applied to both navbar and loading screen

**Iteration 3 — Size & positioning tweaks (FINAL)**:
- **Loading screen logo**: height 44px, `margin-right: 12px` (shifts logo left of spinner), `margin-bottom: 32px`
- **Navbar logo**: height 32px, `margin-left: -8px` (shifts slightly left)
- Loading screen kept inline layout (logo beside spinner — user preferred this over stacked)

**Final CSS**:
```css
.dash-nav-logo { height: 32px; object-fit: contain; margin-left: -8px; }
.dash-loading-logo { height: 44px; margin-bottom: 32px; margin-right: 12px; object-fit: contain; }
```

### Risk Insights Spacing Fix
- Widened the alerts row grid column from `200px` to `260px` for risk card: `grid-template-columns: 1fr 260px`
- Changed risk row layout from `justify-content: space-between` to `gap: 10px` with `flex: 1` on `.dash-risk-name`
- Added `white-space: nowrap` on `.dash-risk-val` to prevent value wrapping

### Git Commits (this session, chronological)
1. `a2dd340` — Add static Patient Outreach tab with phone, SMS, email cards and outreach template
2. `beceef9` — Fix R Systems logo visibility and Risk Insights spacing
3. `9817119` — Fix logo - remove white background, show colored logo directly on dark bg
4. `452e645` — Reduce logo size and add spacing between logo and spinner
5. `e64e606` — Revert loading logo to inline layout, shift navbar logo left
6. `7a8c64d` — Shift loading screen logo left with margin-right spacing

### Current Dashboard Tab State
| Tab | Status | Content |
|-----|--------|---------|
| AI Actions | Active/Clickable | Dynamic — AI-structured actions with approve workflow |
| Clinical Trends | Disabled | Not implemented |
| Task Queue | Disabled | Not implemented |
| Patient Outreach | Active/Clickable | Static — Phone/SMS/Email cards + message template |

### Patient Banner Spacing Fix
- **Meta row** (age · Male · MRN · Programs): Changed from plain `<p>` with `·` text separators to `<div>` with individual `<span>` items and styled `dash-meta-sep` dot separators
- **Separator dots**: `font-size: 18px`, `font-weight: 700`, color `#94A3B8`, `margin: 0 8px`
- **Contact row** (DOB, phone, email): Removed dot separators, items spread with `gap: 32px`
- **Row vertical spacing**: Meta row `margin-top: 8px`, contact row `margin-top: 12px`
- **User feedback**: "OK better but needs more UI tweaks" — will revisit later
- **Commits**: `6e8d4d5`, `d699964`, `de68f1d`

### Task Queue Tab — IMPLEMENTED (Dynamic)
- **Commit**: `ce6f7bc` — "Implement Task Queue tab with status cards, task flow, and Figma-matching UI"
- **Tab enabled**: Task Queue tab is now clickable (`activeTab === 'queue'`), joins AI Actions and Patient Outreach as active tabs. Clinical Trends remains disabled.

**State Management:**
- `taskQueue` — array of task objects `{ id, title, priority, priorityClass, status, dueDate, description, notes }`
- `taskFilter` — `'pending'` | `'inprocess'` | `'completed'` (default: `'pending'`)
- `taskCounts` — computed counts for each status
- `filteredTasks` — tasks filtered by current `taskFilter`

**Flow:**
1. User selects actions in AI Actions tab → clicks "Approve Selected" → modal opens
2. User adds optional coordinator notes → clicks "Confirm & Create Tasks"
3. `handleApprove()` creates task objects from approved actions:
   - Due date calculated from timeframe: "Within 24 hours" → +1 day, "Within 48 hours" → +2, "Within 1 week" → +7, default → +3
   - Notes = coordinator notes (if entered) or AI rationale
   - Deduplicates by title (won't create duplicate tasks)
   - All new tasks start with `status: 'pending'`
4. Tasks appear in Task Queue tab

**Status Transitions:**
- `updateTaskStatus(taskId, newStatus)` — updates a task's status
- Pending → "Start Task" button → In Process
- Pending → "Mark Complete" button → Completed
- In Process → "Mark Complete" button → Completed
- Completed → shows "✓ Completed" label (no further actions)

**UI (matches Figma):**
- **Summary cards**: 3 clickable cards (Pending/In Process/Completed) with status icons, labels, and colored count badges. Active card has purple border + light purple background
- **Task cards**: Light blue background (`#F0F9FF`), blue border, containing:
  - Title (bold)
  - Priority pill + Status pill + Due date
  - Description text
  - NOTES section (white box with label + italic text)
  - Action buttons (Start Task = green solid, Mark Complete = green outline)
- **Empty state**: Dashed border box with helpful message when no tasks in selected filter

**CSS classes added** (in `dashboard.css`):
- `.tq-summary`, `.tq-summary-card`, `.tq-active`, `.tq-summary-icon`, `.tq-summary-label`, `.tq-badge`
- `.tq-section-header`, `.tq-empty`
- `.tq-task-card`, `.tq-task-header`, `.tq-task-meta`, `.tq-due`, `.tq-status-pill`
- `.tq-task-desc`, `.tq-notes`, `.tq-notes-label`
- `.tq-btn-start`, `.tq-btn-complete`, `.tq-completed-label`

### Updated Dashboard Tab State
| Tab | Status | Content |
|-----|--------|---------|
| AI Actions | Active/Clickable | Dynamic — AI-structured actions with approve workflow |
| Clinical Trends | Disabled | Not implemented |
| Task Queue | **Active/Clickable** | Dynamic — approved tasks with Pending/In Process/Completed flow |
| Patient Outreach | Active/Clickable | Static — Phone/SMS/Email cards + message template |

### All Git Commits (April 3 session, chronological)
1. `a2dd340` — Add static Patient Outreach tab
2. `beceef9` — Fix R Systems logo visibility and Risk Insights spacing
3. `9817119` — Fix logo - remove white background, show colored logo directly on dark bg
4. `452e645` — Reduce logo size and add spacing between logo and spinner
5. `e64e606` — Revert loading logo to inline layout, shift navbar logo left
6. `7a8c64d` — Shift loading screen logo left with margin-right spacing
7. `7f7ceed` — Update notes.md with April 3 session
8. `6e8d4d5` — Add proper spacing between patient banner meta items
9. `d699964` — Increase separator dot size and spacing in patient banner
10. `de68f1d` — Increase row spacing, spread contact items wider
11. `57f2c2a` — Update notes.md with patient banner spacing changes
12. `ce6f7bc` — Implement Task Queue tab
13. `34c8648` — Update notes.md with Task Queue details
14. `03b102b` — Make Clinical Notes dynamic from Encounter API
15. `d76b48b` — Add Admin note type

---

## Clinical Notes — IMPLEMENTED (Dynamic) — April 6, 2026

### Overview
The Clinical Notes section in the right sidebar is now fully dynamic. It extracts clinical notes from the Encounter API, resolves practitioner names, and supports adding new notes via a form.

### Data Flow
1. Encounters already fetched in `loadDashboard()` via `/baseR4/Encounter?patient={id}`
2. `parseClinicalNotesFromEncounters(encBundle, careManagerIds)` function:
   - Iterates all encounter entries, extracts `extension` where `url === "clinicalNotes"`
   - Groups by practitioner ID → picks the **latest** note per practitioner (one note per practitioner)
   - Fetches each unique practitioner from `/baseR4/Practitioner?_id={id}&page=0&size=1` to get name, prefix, specialty
   - Classifies note type: if practitioner ID is in `careManagerIds` (from EpisodeOfCare) or specialty matches /coordinator|care manager|nurse/ → **"Coordination"**, else → **"Clinical"**
   - Generates initials from practitioner name
   - Formats date as "Mon DD, YYYY · HH:MM AM/PM"
   - Sorts by date descending (latest first)
3. `careManagerIds` extracted from EpisodeOfCare bundle: `eocBundle.entry[].resource.careManager.reference` → stripped to UUID

### State Variables
- `clinicalNotesData` — parsed notes from encounters (array of note objects)
- `addedNotes` — notes added locally via "Add Note" form
- `showAddNoteModal` — boolean toggle for add note modal
- `newNote` — `{ author, role, type, text }` form state
- `viewingNote` — note object being viewed in View modal (null when closed)

### Computed Values
- `allNotes` — `[...clinicalNotesData, ...addedNotes]` (dynamic + locally added)
- `adminNotes` — `addedNotes.filter(n => n.type === 'Admin')` (only Admin-typed added notes)
- `filteredNotes` — filtered by `noteFilter`:
  - `'all'` → all notes
  - `'clinical'` → notes with type "Clinical"
  - `'coordination'` → notes with type "Coordination"
  - `'admin'` → only admin-typed added notes

### Filter Tabs
| Tab | Shows | Count Source |
|-----|-------|-------------|
| All | All notes (dynamic + added) | `allNotes.length` |
| Clinic | Notes with type "Clinical" | `allNotes.filter(type=Clinical)` |
| Care | Notes with type "Coordination" | `allNotes.filter(type=Coordination)` |
| Admin | Only admin-typed added notes | `adminNotes.length` |

### "Add Note" Modal
- Opens via "+ Add Note" button
- Form fields: Author Name, Role, Note Type (Clinical / Coordination / Admin), Note text
- Note Type selector: 3 toggle buttons, "Admin" type notes only appear under Admin tab
- On submit: creates note with current timestamp, adds to `addedNotes` state
- CSS class: `.cn-modal` (max-width 520px)

### "View" Modal
- Opens when "View" link is clicked on any note
- Shows: author avatar + name + role, type pill, full note text, timestamp
- Close button in footer

### Note Type Pills (CSS)
- `.pill-note-clinical` — blue (`#DBEAFE` / `#2563EB`)
- `.pill-note-coordination` — amber (`#FEF3C7` / `#D97706`)
- `.pill-note-admin` — purple (`#F3E8FF` / `#7C3AED`)

### CSS Classes Added
- `.cn-modal`, `.cn-input`, `.cn-type-select`, `.cn-type-btn`, `.cn-view-meta`, `.cn-view-text`, `.cn-view-date`, `.pill-note-admin`

### Updated Dashboard Dynamic Sections Status
| Section | Status | Data Source |
|---------|--------|------------|
| Patient Banner | Dynamic | `/baseR4/Patient/{id}` |
| Alerts & Trends | Dynamic | AI analysis of care gap text |
| AI Actions | Dynamic | AI analysis of care gap text |
| Vitals | Dynamic | `/baseR4/Observation/search` |
| Medications | Dynamic | `/baseR4/MedicationRequest` |
| Appointments & Encounters | Dynamic | `/baseR4/Encounter` + AI missed appointments |
| Care Team | Dynamic | `/baseR4/EpisodeOfCare` — care managers |
| Risk Insights | Dynamic | `POST /api/predict` — risk prediction API |
| Clinical Notes | **Dynamic** | `/baseR4/Encounter` (clinicalNotes extension) + `/baseR4/Practitioner` (name resolution) + local "Add Note" |

**All dashboard sections are now dynamic — no more static mock-only sections.**

---

## Session: April 6, 2026 — Patient 2 Data Generation

### Measurement Master — Unit Fix
- Found 574 out of 742 rows in `Measurement_Master` were missing `expected_unit` values
- Created `fix_units.py` script with a dictionary mapping ~67 LOINC codes to their standard units and reference ranges
- After running: 335 additional units were populated; remaining rows are less common LOINC codes
- Also verified that vital signs (Heart Rate, BP systolic/diastolic, Body Temp, Glucose) are present in `Measurement_Master` with correct LOINC codes

### Condition Master — ICD-9 → ICD-10 Migration
- Master table was migrated from ICD-9 to ICD-10 codes since last session
- All Patient 2 conditions use ICD-10 codes from the updated `Condition_Master`
- Patient 1 conditions still reference ICD-9 codes in the data (no change)

### Knowledge Base Updates
- **CONDITION_CODES**: ICD-10 codes for Patient 2 merged INTO the existing `CONDITION_CODES` section (not separate). Both ICD-9 (Patient 1) and ICD-10 (Patient 2) codes coexist in format `CODE=Description`
- **DRUG_CODES**: Added ENTR49, ENTR97, SACV49, SACV97 (Sacubitril-Valsartan formulations)
- **PROCEDURE_CODES**: Added 93000 (ECG), 93010 (ECG interp), 93303 (Echo TTE), 93306 (Echo Doppler TTE)

### chatbase_data.xlsx — Patient 2 Sheets
All 24 sheets were appended with Patient 2 data (yellow background `#FFFF99`):
- patient, encounter, condition, observation, procedure, medicationRequest, appointment
- allergy, diagnosticReport, serviceRequest, immunization, documentReference, episodeOfCare
- organization, practitioner
- Master tables updated: medication_code_master (4 new entries), Condition_Master (verified), Measurement_Master (units fixed), Procedure_Master (verified)

### Files to NEVER commit (updated)
`chatbase_data.xlsx`, `generate_*.py`, `check_*.py`, `cleanup_sheets.py`, `fix_units.py`, `~$chatbase_data.xlsx`, `.env`

---

## Session: April 7, 2026

### Clinical Notes — "Unknown" Practitioner Issue (DATA FIX)
- One of the 3 clinical notes showed "Unknown / Physician" instead of a practitioner name
- Root cause: The practitioner ID `d4e9f6a3-0b5c-6d7e-1f8a-3c4d5e6f7a8b` (Lisa Wong, Wound Care) referenced in the encounter didn't match the actual practitioner ID in the database
- Fix: Backend data fix — user confirmed it's now working after correcting the ID

### Vitals — Show 4 with "Show All" Toggle
- Previously all vitals were shown at once (could be 7+ for Patient 1)
- Added `showAllVitals` state, shows only **4 vitals by default**
- "▼ Show All (X more)" button appears when >4 vitals, same pattern as Current Medications and Appointments
- "▲ Show Less" collapses back to 4
- **Commit**: `41872c8` — "Show 4 vitals by default with Show All toggle for remaining"

### Practitioner Data Reference (from Excel)
**Patient 1 practitioners (non-yellow rows):**
| ID (prefix) | Family | Given | Specialty |
|---|---|---|---|
| b2c7d4e1 | Chen | Sarah | Endocrinology |
| c3d8c5f2 | Brooks | Michael | Internal Medicine |
| d4e9f6a3 | Wong | Lisa | Wound Care |
| e5f0a7b4 | Patel | David | Nephrology |
| 596f43c8 | Torres | Rebecca | Diabetes Care Coordinator |
| fc41e2aa | Rivera | Angela | Chronic Care Coordinator |
| 8a120908 | Marshall | Kevin | Cardiovascular |
| 779f3a81 | Hoffman | Patricia | Wound Care Coordinator |

Only 3 practitioners appear in encounters: Chen (most), Brooks (3), Wong (2).

**Patient 2 practitioners (yellow rows):**
| ID (prefix) | Family | Given | Specialty |
|---|---|---|---|
| 4a6e566f | Patel | Anita | Cardiology |
| b0044caa | Nguyen | David | Pulmonology |
| 729629b8 | Martinez | Lisa | Care Coordinator |
| 8c58388e | Johnson | Angela | Care Coordinator |
| 44e239b0 | Williams | Patricia | Care Coordinator |
| 9ea70bec | Anderson | Karen | Care Coordinator |

### Clinical Trends Tab — IMPLEMENTED (Dynamic) — April 7, 2026

**Overview**: The Clinical Trends tab is now fully dynamic. It auto-detects which observations the patient has, picks the top 3 by data point count as individual chart tabs, and combines remaining observations into a 4th "Lab Results" tab.

**Dependencies Added**:
- `react-chartjs-2` — React wrapper for Chart.js (Chart.js 4.x was already installed)
- Chart.js modules registered: `CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler`

**Key Implementation Details**:

1. **`parseAllObservationsForTrends(bundle)`** — New parser that extracts ALL observations (not just latest per type), groups by LOINC code, stores all data points with dates for trend plotting.

2. **`ALL_OBS_GROUPS`** — Defines 15 known observation groups with chart config:
   - Each group has: `key`, `label`, `codes[]`, `colors[]`, `targets[]`, `targetLabels[]`, optional `fill`
   - Groups: BP (systolic+diastolic), Glucose, Heart Rate, HbA1c, Creatinine, NT-proBNP, Potassium, LDL, Cholesterol, Triglycerides, Sodium, Body Temp, Hemoglobin, WBC, Platelets

3. **`buildDynamicTrendTabs(obsData)`** — Dynamically generates tabs:
   - Scans `ALL_OBS_GROUPS` to find which groups have data points in `obsData`
   - Sorts by total data point count (most data = first tab)
   - Takes top 3 as individual tabs
   - Remaining groups combined into a 4th "Lab Results" tab
   - Returns array of tab configs (not a static object)

4. **Chart Rendering** (Chart.js `Line` component):
   - 30 Day / 6 Month period toggle filters data by cutoff date
   - Data series with colors, target/reference lines (dashed)
   - Tooltips show date + value
   - `spanGaps: true` for continuous lines when dates don't align
   - Height: 300px

5. **Bottom Stats** — Dynamically computed from top 3 observation types (by data count):
   - Shows percentage change (first → last reading)
   - Latest value with units
   - Warning icon if latest value is abnormal (outside normal range)
   - Patient-specific — adapts to whatever observations the patient has

**Patient-Specific Tab Examples**:
- **Patient 1 (Diabetes)**: Glucose, HbA1c, Creatinine as tabs 1-3; LDL, Cholesterol, Potassium, Triglycerides in Lab Results
- **Patient 2 (CHF)**: BP, Heart Rate, NT-proBNP as tabs 1-3; Creatinine, Glucose, Potassium, Sodium in Lab Results

**State Variables Added**:
- `allObsData` — All observations grouped by LOINC code with all time points
- `trendTab` — Currently selected chart tab key (null = auto-select first)
- `trendPeriod` — `'30d'` or `'6m'`

**CSS Classes Added** (in `dashboard.css`):
- `.ct-header`, `.ct-title`, `.ct-subtitle`
- `.ct-period-toggle` + `.ct-period-toggle button.active`
- `.ct-tabs`, `.ct-tab`, `.ct-tab.active`
- `.ct-chart-area`
- `.ct-legend-info`, `.ct-legend-item`
- `.ct-bottom-stats`, `.ct-stat`, `.ct-stat-icon`, `.ct-stat-label`, `.ct-stat-value`

**OBSERVATION_NORMAL_RANGES Extended**:
Added ranges for: Heart Rate (8867-4), Systolic BP (8480-6), Diastolic BP (8462-4), Body Temperature (8310-5), NT-proBNP (33762-6), Sodium (2951-2)

### Patient Outreach — Text Shortened
- "Direct phone outreach to discuss care gaps" → "Call to discuss care plan"

### Updated Dashboard Tab State
| Tab | Status | Content |
|-----|--------|---------|
| AI Actions | Active/Clickable | Dynamic — AI-structured actions with approve workflow |
| Clinical Trends | **Active/Clickable** | Dynamic — Chart.js line charts with auto-detected observation tabs |
| Task Queue | Active/Clickable | Dynamic — approved tasks with Pending/In Process/Completed flow |
| Patient Outreach | Active/Clickable | Static — Phone/SMS/Email cards + message template |

**All 4 dashboard tabs are now fully implemented.**

### Clinical Trends — Period Toggle Changed
- Removed 30 Day / 6 Month toggle buttons
- Replaced with single **"12 Month View"** toggle button
- **Default**: Shows ALL observation data (full 3-year history)
- **Click "12 Month View"**: Filters to past 12 months only
- **Click again**: Toggles back to showing all data
- State default changed from `'6m'` to `'all'`
- Cutoff logic: `'12m'` = `new Date().setFullYear(new Date().getFullYear() - 1)`, `'all'` = no filter (all points shown)

### Risk Insights — Upgraded with Clickable Tiles + Detail Modal — April 7, 2026

**API Change**:
- **Endpoint**: `POST https://fhirassist.rsystems.com:5050/api/predict`
- **Body**: `{"uuid": "<patient_id>"}`
- **Auth**: Bearer token (same login token from `localStorage`)
- **Response**: HTML page with `var D={...}` embedded in `<script>` tag
- **Old endpoint `predictHealthRisk`**: REMOVED (returns 405 METHOD NOT ALLOWED)
- **Parser**: Brace-depth counting to extract nested JSON from HTML (regex `[\s\S]*?` fails on nested objects)

**Data Extracted from `var D`**:
- `risk_level`: "High" / "Moderate" / "Low"
- `risk_percentage`: number (e.g., 82.1)
- `risk_drivers`: array of strings (detailed explanations)
- `protective_factors`: array of strings (positive factors)

**UI Changes**:
- **Tile design**: Each risk shows an icon (SVG from `fhirassist.rsystems.com:5050/src/tileIcons/`), name, percentage in blue (#0068B3), and colored badge (HIGH=red, MODERATE=yellow, LOW=green)
- **Icons mapped**: `cvd` → hipertension.svg, `diabetes` → diabteis.svg, `cancer` → cancer.svg
- **Clickable tiles**: Tap any tile → opens detail modal
- **Detail modal**: Shows risk percentage + level (color-coded), "Why this risk is high/low" subtitle, Risk Drivers bullet list, Protective Factors (green, shown only when present)
- **"Tap a tile to see detailed insights"** hint at bottom
- **AI Powered badge**: Sparkle SVG icon + gradient purple badge

**CSS Classes Added** (in `dashboard.css`):
- `.ri-head`, `.ri-title`, `.ri-ai` — header with AI badge
- `.ri-list`, `.ri-row`, `.ri-row:hover` — clickable tile rows
- `.ri-icon`, `.ri-icon-high/mod/low` — colored icon backgrounds
- `.ri-info`, `.ri-name`, `.ri-pct` — name + percentage
- `.ri-badge`, `.ri-badge-high/mod/low` — level pills
- `.ri-hint` — bottom hint text
- `.ri-modal` — modal sizing (max-width 480px, max-height 80vh)
- `.ri-modal-title`, `.ri-modal-hl`, `.ri-hl-high/mod/low` — modal title with colored highlight
- `.ri-modal-sub`, `.ri-modal-sh`, `.ri-modal-ul` — modal sections

**State Added**: `viewingRisk` — risk object being viewed in modal (null when closed)

**Debugging History**:
1. First attempt used regex `[\s\S]*?` to parse JSON — failed (non-greedy matched first `}` in nested JSON)
2. Fixed with brace-depth counting parser
3. Tried dual endpoint (`predictHealthRisk` JSON first, `predict` HTML fallback) — `predictHealthRisk` returned 405
4. Removed dual endpoint, using only `/api/predict`
5. Fixed modal scroll for Diabetes protective factors (added `max-height: 80vh`, `overflow-y: auto`, `min-height: 0`)

**Protective Factors Fix (RESOLVED)**:
- Issue: Protective factors (e.g., "Non-Smoker" for Diabetes, "Age/CRE/Potassium normal" for Cancer) were not rendering in the risk detail modal despite being correctly parsed from the API response.
- Root cause: The optional chaining conditional `viewingRisk.protective?.length > 0` was failing silently. Changing to `(viewingRisk.protective || []).length > 0` fixed the issue.
- The modal scroll CSS was also updated: `.ri-modal .dash-modal-body { overflow-y: auto; max-height: 60vh; }` ensures long content (4 risk drivers + protective factors) is scrollable.

### Risk Insights UI Refinement & Layout Merge (April 7)

**Layout Change**: Merged Risk Insights into the Alert Triggers & Risk Drivers card.
- Previously: Two separate cards side-by-side in a `dash-alerts-row` grid (`1fr 300px`)
- Now: **One card** with an internal 2-column grid (`dash-alerts-inner`: `1fr 260px`)
  - Left column (`dash-alerts-left`): Alert items + Deteriorating Clinical Trends bar
  - Right column (`dash-alerts-right`): Risk Insights tiles (icon, name, percentage, badge)
  - Separated by a subtle vertical border (`border-left: 1px solid #E2E8F0`)
  - Left column has `padding-right: 20px` for breathing room from the divider
  - Mobile responsive: stacks vertically with horizontal border instead

**CSS Changes** (`dashboard.css`):
- Removed: `.dash-alerts-row` (old 2-column grid), `.dash-risk-card`, `.dash-risk-row`, `.dash-risk-name`, `.dash-risk-val`
- Added: `.dash-alerts-inner`, `.dash-alerts-left`, `.dash-alerts-right`
- Risk tile CSS (`.ri-*`) tightened for 260px column: title 14px, name 12px, pct 16px, badge 9px, icon 30px, AI badge 9px

**JSX Changes** (`DashboardPage.jsx`):
- Removed separate `<div className="dash-card dash-risk-card">` 
- Added internal `dash-alerts-inner` wrapper with `dash-alerts-left` and `dash-alerts-right` divs inside single `dash-alerts-card`

**Revert Point**: `1324635` (last commit before the merge)

### Git Commits (April 7 session)
1. `41872c8` — Show 4 vitals by default with Show All toggle
2. `ce15890` — Implement Clinical Trends tab with dynamic charts, 30d/6m toggle, and patient-specific bottom stats
3. `4157587` — Replace 30d/6m toggle with 12 Month View toggle, default shows all trends
4. `775a95a` — Upgrade Risk Insights with clickable tiles, icons, detail modal
5. `df57d27` — Fix Risk API parser - brace-depth counting for nested JSON
6. `a16b487` — Fix Risk API - try predictHealthRisk JSON first, fallback to predict HTML
7. `b16b538` — Use single /api/predict endpoint, fix risk modal scroll
8. `718d631` — Fix protective factors not rendering in risk modal
9. `50274a1` — Clean up debug logs, fix protective factors rendering
10. `1324635` — Improve Risk Insights UI - widen column to 300px, tighten spacing
11. `752d9a1` — Merge Risk Insights into Alert Triggers card as internal right column
12. `0f18aee` — Add right padding to alerts left column for divider spacing

### All Dashboard Sections Status (as of April 7)
| Section | Status | Data Source |
|---|---|---|
| Patient Banner | Dynamic | Patient API |
| Alert Triggers & Risk Drivers + Risk Insights | Dynamic | Care gap analysis (sessionStorage) + POST /api/predict (HTML parse, Bearer token) — **merged into one card** |
| Care Team | Dynamic | EpisodeOfCare API (care managers only) |
| Vitals | Dynamic | Observation API (latest, 4 shown + Show All) |
| AI Actions | Dynamic | Care gap analysis |
| Task Queue | Dynamic | Approved AI Actions (local state) |
| Clinical Notes | Dynamic | Encounter API extensions + local Add Note |
| Patient Outreach | Static | Template with dynamic patient name |
| Clinical Trends | Dynamic | Observation API (time-series charts, 12m toggle) |
| Appointments & Encounters | Dynamic | Encounter API |
| Medications | Dynamic | MedicationRequest API |

---

## Care Team Updates (April 8, 2026)

### Changes Made
1. **Show only name and specialty** — Removed the "Care Coordinator" subtitle from each card. Now shows only the coordinator's name and their program/specialty (e.g., "Chronic Care Coordination", "Diabetes Disease Management Program").
2. **Email icon opens Outlook** — Changed the email icon from a plain `<button>` to an `<a href="mailto:...">` link. Clicking it opens the user's default email client (Outlook) with the coordinator's email pre-filled in the "To" field.
3. **Practitioner email fetching** — `parseCareTeamFromEoC` is now async. It extracts the `careManager.reference` (Practitioner UUID) from each EpisodeOfCare, fetches the Practitioner API to get the email from `telecom` (system=email), and stores it in the care team data.

### Files Changed
- `src/components/DashboardPage.jsx` — `parseCareTeamFromEoC` made async with practitioner email fetch; Care Team JSX simplified to name + program only; email button replaced with `mailto:` anchor link
- `src/dashboard.css` — Added `.dash-team-email-link` style (matches existing button style)

### Git Commit
- `7dcd2cc` — Care Team: show only name and specialty, email icon opens mailto link

---

## Session Updates (April 8, 2026)

### Protective Factors Fix (RESOLVED)
- Protective factors (e.g., "Non-Smoker" for Diabetes) were not rendering in the Risk Insights detail modal
- Root cause: `viewingRisk.protective?.length > 0` optional chaining was failing silently
- Fix: Changed to `(viewingRisk.protective || []).length > 0`
- Modal scroll CSS: `.ri-modal .dash-modal-body { overflow-y: auto; max-height: 60vh; }`

### Risk Insights Layout Merge
- **Merged Risk Insights into the Alert Triggers & Risk Drivers card** as an internal right column
- Previously: Two separate cards side-by-side (`dash-alerts-row` grid `1fr 300px`)
- Now: One card with internal 2-column grid (`dash-alerts-inner`: `1fr 260px`)
  - Left: Alert items + Deteriorating Clinical Trends
  - Right: Risk Insights tiles (icon, name, percentage, badge)
  - Separated by vertical border (`border-left: 1px solid #E2E8F0`)
  - Left column has `padding-right: 20px` for breathing room
- Removed: `.dash-alerts-row`, `.dash-risk-card`, `.dash-risk-row`
- Added: `.dash-alerts-inner`, `.dash-alerts-left`, `.dash-alerts-right`
- Revert point: `1324635`

### Chatbot Predefined Actions
- **Added "Plot HbA1c Trends"** to the lightbulb dropdown (`PREDEFINED_ITEMS`)
  - Uses `query` property: user sees "Plot HbA1c Trends", agent receives `"plot line chart for last 1 year trend for hba1c"`
  - `handlePredefinedClick` updated to use `item.query || item.label` when calling `agentLoop`

### Observations System Prompt Fix
- **Problem**: Bot was making separate API calls per LOINC code. On the first attempt, it would pick just one observation type (e.g., Hemoglobin 718-7), get no 2025 data for it, and report "no observations found". On retry it worked.
- **Fix**: Changed prompt to instruct bot to make a **SINGLE call** without CODE parameter (`search_patient_observations` with just PATIENT + DATE=gt2025-01-01). This returns ALL observation types in one response, matching how Postman works.
- Bot then groups results by `code.coding[0].display` and presents as clinical summary
- Also fixed: user's `SUBJECT` → `PATIENT` parameter name correction across observation sections

### Reverted Changes (not kept)
- Care Gaps silent override (`query: 'View Care Gaps in details'`) — reverted
- Latest-only observations (show single latest value per type) — reverted
- Smart scroll (allow scrolling up while bot responds) — reverted
- Auto-retry observations (silently retry when bot returns no data) — reverted

### Git Commits (April 8 session)
1. `50274a1` — Clean up debug logs, fix protective factors rendering
2. `1324635` — Improve Risk Insights UI - widen column to 300px, tighten spacing
3. `752d9a1` — Merge Risk Insights into Alert Triggers card as internal right column
4. `0f18aee` — Add right padding to alerts left column for divider spacing
5. `8080988` — Update notes.md with layout merge details
6. `9dd5ffd` — Add Plot HbA1c Trends to predefined actions dropdown
7. `b1fe720` — (reverted) Latest-only observations
8. `034794a` — (reverted) Revert observations
9. `ce2f47e` — (reverted) Smart scroll
10. `edff1c7` — (reverted) Care gaps override + latest-only obs
11. `214fc94` — Revert care gaps, latest-only obs, smart scroll
12. `3968ae9` — Remove DATE filter (then restored)
13. `079c4b9` — Restore DATE filter with client-side filtering (then replaced)
14. `817d53c` — (reverted) Hardcoded 9 LOINC codes
15. `6e00976` — Restore original observations prompt
16. `a99e908` — User's system prompt changes
17. `203f171` — Fix observations - single API call without CODE
18. `a65346e` — Fix SUBJECT back to PATIENT
19. `fafdf89` — Restore PATIENT in section 3
20. `c8fc2a7` — Fix SUBJECT to PATIENT in filtered observation section
21. `ab5fe4d` — Update notes.md with April 8 session details
22. `982c72c` — Show only latest value per observation type in recent observations

### Latest Observations — Final Behavior (CONFIRMED WORKING)
- **Single API call**: `search_patient_observations` with PATIENT + DATE=gt2025-01-01, no CODE param
- **One value per type**: For each observation type (HbA1c, Glucose, Creatinine, etc.), shows only the single most recent value by date
- **Classification**: Each value includes Low/Normal/High/Critical from OBSERVATION_RANGES knowledge base
- **No hardcoded LOINC codes**: Works for any patient regardless of their conditions

### Care Gaps Silent Override (IMPLEMENTED)
- "View Care Gaps" dropdown item now sends `"View Care Gaps in details"` to the agent internally
- User sees "View Care Gaps" in chat, agent receives the detailed query
- Uses `query` property on the predefined item: `{ label: 'View Care Gaps', action: 'caregaps', query: 'View Care Gaps in details' }`

### Smart Scroll (IMPLEMENTED)
- While bot is responding, user can scroll up to read previous messages without being forced to bottom
- `userScrolledUpRef` tracks if user has scrolled more than 80px from bottom
- If scrolled up → auto-scroll pauses
- If user scrolls back to bottom → auto-scroll resumes
- When user sends a new message or clicks predefined action → `userScrolledUpRef` resets, auto-scroll resumes
- `onScroll={handleMessagesScroll}` attached to messages area div

### Risk Modal Scroll Fix (CONFIRMED WORKING)
- **Problem**: Diabetes risk modal had long risk driver paragraphs; protective factors were cut off and not visible even after scrolling
- **Root cause**: `.dash-modal` lacked `display: flex; flex-direction: column; overflow: hidden;` — inner body couldn't scroll within the modal's `max-height: 85vh`
- **Fix**: Added flexbox layout to `.dash-modal` and removed the redundant `max-height: 60vh` from `.ri-modal .dash-modal-body`
- **Result**: All 3 risk modals confirmed working:
  - Hypertension: 4 drivers, no protective factors ✓
  - Diabetes: 4 drivers + 1 protective factor (Non-Smoker) ✓
  - Cancer: 3 drivers + 3 protective factors ✓
- Commit: `f444a95`

### Risk Insights API Endpoint Change (CONFIRMED WORKING)
- **Old**: `POST https://fhirassist.rsystems.com:5050/api/predict` with body `{"uuid": patientId}`
- **New**: `GET https://fhirassist.rsystems.com:8081/api/v1/predict/risk-insights?patient_id=<id>` with Bearer Token
- Same HTML response format with embedded `var D={...}` JSON — no parser changes needed
- Response still contains risk data for cvd/diabetes/cancer with risk_level, risk_percentage, risk_drivers, protective_factors
- **Note**: Protective factors for diabetes may or may not appear depending on the ML model's inference run (traditional ML, output varies). Our code handles both cases correctly (shows section if present, hides if empty)
- Commit: `6511257`

### Git Commit History (continued)
23. `676ffcf` — Add Care Gaps silent override and smart scroll, update notes.md
24. `f444a95` — Fix risk modal scroll - protective factors now visible
25. `3440d8e` — Update notes.md with risk modal scroll fix details
26. `6511257` — Update risk insights API from POST /5050 to GET /8081 with patient_id query param
27. `448f110` — Update notes.md with risk API endpoint change and commit history

### Dashboard Batch Update — April 9, 2026

#### 1. Clinical Trends — All Individual Tabs with Horizontal Scroll
- **Removed** the "Lab Results" combined tab that grouped remaining observations
- **Now shows all** observation groups as individual tabs (Glucose, Creatinine, Potassium, HbA1c, Cholesterol, LDL, Triglycerides, etc.)
- Tabs sorted by data density (most data points first)
- **Horizontal scroll** added to tabs row via `overflow-x: auto` with thin scrollbar styling
- Each tab is pill-shaped (`border-radius: 20px`), `flex-shrink: 0`, `white-space: nowrap`
- Files: `DashboardPage.jsx` (simplified `buildDynamicTrendTabs`), `dashboard.css` (`.ct-tabs`, `.ct-tab`)

#### 2. MRN from Patient Identifiers
- **Previously**: Showed patient UUID as MRN (e.g., `a3f8b2c1-7d4e-...`)
- **Now**: Extracts actual MRN from Patient resource's `identifier` array, matching `type.coding[0].code === 'MR'` or `system` containing `'mrn'`
- Falls back to patient UUID if no MRN identifier found
- File: `DashboardPage.jsx` (`parsePatientFromResource`)

#### 3. AI Actions — Remove Approved Actions
- **Previously**: Approved actions were greyed out with checkbox ticked and disabled
- **Now**: Approved actions are completely removed from the AI Recommended Actions list (`return null` if index in `approvedActions`)
- Only unapproved actions remain visible

#### 4. AI Actions — Exact Due Dates
- **Previously**: Showed relative timeframes like "Within 24 hours", "Within 48 hours", "Within 1 week"
- **Now**: Shows computed due date (e.g., "Due: Apr 10, 2026") using the same calculation logic as Task Queue
- 24 hours → +1 day, 48 hours → +2 days, 1 week → +7 days, other → +3 days

#### 5. Plot Trends Action Chip
- **Renamed**: "Plot HbA1c Trends" → "Plot Trends"
- **No silent override** (reverted): Sends plain `"Plot Trends"` to the agent as-is
- Silent override to be added later per user's instructions

#### 6. Coordinator Notes Removed
- Removed the "Coordinator Notes (Optional)" textarea from the Approve & Create Tasks modal
- Only the selected actions list and assignment info remain

#### 7. MRN Prefix Strip
- MRN display strips the `MRN-` prefix (e.g., `MRN-20230301-001` → `20230301-001`)
- Dashboard shows `MRN: 20230301-001`

#### 8. AI Actions Empty State
- When all actions are approved, shows: "✅ All actions have been approved and moved to Task Queue"
- Centered grey text with padding, replaces blank space

### Git Commit History (continued)
28. `d4203e7` — Clinical trends all tabs, MRN from identifiers, remove approved actions, due dates, plot trends chip
29. `028b30c` — Remove Coordinator Notes block from approve modal
30. `540d4ac` — Strip MRN- prefix from MRN display value
31. `25cacf3` — Show empty state message when all AI actions are approved
32. `b57388b` — Update Plot Trends silent query to clarify separate from care gaps
33. `e6cf3cc` — Remove silent override from Plot Trends - sends plain label for now
34. `622f99e` — Update notes.md with all April 9 dashboard changes
35. `753b55b` — Set Y-axis to start from 0 in clinical trends charts
36. `6b6aded` — Filter clinical trends to only show deteriorating observations

### Clinical Trends — Y-Axis Starts from 0
- Changed `beginAtZero: false` → `beginAtZero: true` in Chart.js Y-axis config
- All charts now consistently start from 0 on the Y-axis

### Clinical Trends — Deteriorating Only Filter
- `buildDynamicTrendTabs` now accepts `deterioratingTrends` (from `dynTrends` / care gap analysis)
- Only shows tabs for observations that match the deteriorating trend labels
- Matching is flexible: compares group label, key, and LOINC code names (case-insensitive, strips "TREND" suffix)
- If no deteriorating trends data is available, falls back to showing all observations with data

### Task Queue — Database API Integration (IMPLEMENTED)
**3 new API endpoints integrated for persistent task management:**

#### 1. POST `/baseR4/portal/create-recommendations`
- Called when user approves selected AI actions
- Body: Array of `{ patientId, priority, action, description, aiRationale, dueDate }`
- Status always goes as `"pending"`
- Returns created records with `actionId` UUIDs
- Bearer token auth (same login token)

#### 2. GET `/baseR4/portal/task-queue?patientId=...&status=...`
- Fetches tasks from database on dashboard load
- Optional `status` filter: `pending`, `in-process`, `completed`
- Returns array of task objects with all fields
- Task Queue now loads from DB instead of local React state
- Called on initial load via `useEffect` and refreshed after every approve/status change

#### 3. PATCH `/baseR4/portal/update-task?actionId=...&status=...`
- Updates task status: `pending` → `in-process` → `completed`
- "Start Task" sends `status=in-process`, "Mark Complete" sends `status=completed`
- After PATCH, `fetchTaskQueue()` is called to refresh the list

**Key changes in `DashboardPage.jsx`:**
- `handleApprove`: Now async, POSTs to create-recommendations API, then refreshes task queue
- `updateTaskStatus`: Now async, PATCHes update-task API, then refreshes task queue
- `fetchTaskQueue`: New function, GETs tasks from API and maps to local format (maps `in-process` ↔ `inprocess` for internal state)
- `useEffect` on `patientId` triggers initial task queue fetch
- Tasks persist across page refreshes since they're in the database

### Task Queue — 500 Error Fix
- Backend requires `status` param on GET endpoint — calling without it returned 500
- Fixed `fetchTaskQueue` to make 3 parallel GET calls (pending, in-process, completed) and merge results
- Each call has individual error handling so one failure doesn't break others
- Commit: `0efc576`

### Task Status Alerts
- "Start Task" → shows "▶ Task Started" alert for 2 seconds
- "Mark Complete" → shows "✓ Task Completed" alert for 2 seconds
- Uses `taskAlert` state, same green alert style as approve toast
- Commit: `90c4eb3`

### AI Actions — Cross-Check with Task Queue (IMPLEMENTED)
1. **Cross-check on refresh**: After task queue loads from DB, AI action titles are compared against task queue titles (case-insensitive). Matched actions are hidden from AI Recommended Actions
2. **Task Queue dedup by title**: Same title with multiple statuses → only highest status kept (completed > in-process > pending)
3. **AI-generated fallback actions**: When all AI actions are matched, a lightweight LLM call (gpt-4.1-mini) generates 2 new unique actions based on existing task titles. No hardcoded fallbacks
4. `displayActions` computed from `visibleActions` (filtered) or AI-generated fallbacks
5. `handleApprove` and modal now reference `displayActions` instead of raw action array
6. Fallback generation triggers once per page load via `fallbackGeneratedRef`
- Commits: `846bb8f`, `97393b5`

### Git Commit History (continued)
37. `ab9fe89` — Integrate task queue APIs: POST create, GET fetch, PATCH update status
38. `0efc576` — Fix task queue fetch - call GET with explicit status for each
39. `90c4eb3` — Add Task Started and Task Completed alert toasts in Task Queue
40. `846bb8f` — Cross-check AI actions with task queue, dedup tasks by title, fallback actions
41. `97393b5` — Replace hardcoded fallback actions with AI-generated ones via LLM call
42. `4548cb6` — Update notes.md with task queue APIs, cross-check, alerts, and fallback details
43. `bbeb101` — Integrate review APIs: GET review status, POST mark as reviewed, 1-week expiry logic

### Mark as Reviewed — Database API Integration (IMPLEMENTED)

#### GET `/baseR4/portal/get-review?patientId=...`
- Called on page load via `useEffect`
- Returns `{ reviewId, parentId, isReviewed, createdDate }`
- New/unreviewed patient: `isReviewed: false`, `createdDate: null`
- Reviewed patient: `isReviewed: true`, `createdDate: "2026-04-10T17:50:45.9320689"`

#### POST `/baseR4/portal/create-review`
- Body: `{ patientId: "..." }`
- Called when user clicks "Mark as Reviewed"
- Inserts new review record in DB
- After POST, GET is called again to refresh UI

#### Review Logic:
- `isReviewed: false` OR `createdDate: null` → Show **"Mark as Reviewed"** button (clickable)
- `isReviewed: true` + `createdDate` within 1 week → Show **"✓ Reviewed"** (non-clickable) + last review date
- `isReviewed: true` + `createdDate` older than 1 week → Show **"Mark as Reviewed"** again (needs re-review) + last review date still shown
- Last review date displayed below button: "Last reviewed: Apr 10, 2026"
- State: `isReviewed` (boolean), `lastReviewDate` (Date object)
- Functions: `fetchReviewStatus()`, `handleMarkReviewed()`

### Clinical Notes — Tab & Add Note Changes
- **Removed "All" tab** — only Clinic, Care, and Admin tabs remain
- **Default tab**: Clinic (was All)
- **"+ Add Note" button**: Only visible on **Care** tab, hidden on Clinic and Admin
- **Simplified Add Note modal**: Removed Author Name, Role, and Note Type fields — only textarea remains
- **Author**: Auto-set from logged-in user's name (`userName` from `localStorage`)
- **Role**: Hardcoded as "Care Coordinator"
- **Note type**: Always "Coordination" (appears under Care tab)
- `handleAddNote` no longer checks `newNote.author`, only `newNote.text`
- Attempted and reverted full removal of All+Admin tabs before settling on this approach

### Clinical Notes — DocumentReference API Integration (Clinic & Admin Tabs) — April 13, 2026

#### API Details
- **Clinic tab**: `GET /baseR4/DocumentReference?patient=<id>&type.coding=11506-3&page=0&size=100`
- **Admin tab**: `GET /baseR4/DocumentReference?patient=<id>&type.coding=34108-1&page=0&size=100`
- **Care tab**: Remains local (coordinator-added notes via Add Note form)
- Bearer token auth (same login token)

#### Response Structure (per DocumentReference entry)
- `author[0].display` → Author name (e.g., "Sarah Chen")
- `author[0].extension` (url="specialty") → `valueString` (e.g., "Endocrinology", "Wound Care")
- `description` → Short note summary (shown on card)
- `content[0].attachment.data` → Base64-encoded full note text (decoded via `atob()` for View modal)
- `date` → Note date
- `type.coding[0].code` → `11506-3` for Clinical, `34108-1` for Admin

#### Implementation in DashboardPage.jsx
- **New state**: `clinicDocNotes`, `adminDocNotes` — fetched from DocumentReference API on load
- **`parseDocRefNotes(bundle, noteType)`**: Inline parser in `loadDashboard()` that extracts author name, specialty/role, initials, description (card text), full text (base64 decoded), formatted date. Each note gets a `type` field set to `noteType` param ('Clinical' or 'Admin'). Sorts newest-first
- **Two parallel fetch calls** fire on dashboard load alongside other FHIR calls
- **Tab data sources**:
  - Clinic tab: `clinicDocNotes` (from API) → falls back to `clinicalNotesData` (encounter-based) if API returns nothing
  - Admin tab: `adminDocNotes` (from API) → empty array if API returns nothing
  - Care tab: `careNotes` (locally added via Add Note form)
- **Tab counts**: Each tab shows count from its respective data source
- **Total entries**: Sum of all three tab counts
- **View modal**: Shows `fullText` (base64-decoded full note) if available, otherwise falls back to `text` (description)
- **Type guards**: All `.toLowerCase()` calls guarded with `(n.type || 'clinical').toLowerCase()` to prevent TypeError on undefined type

#### First Attempt — Reverted
- First implementation was done and pushed (`1cf25b4`) but had an issue after revert left stale code
- Reverted (`25c48c9`), fixed `TypeError: Cannot read properties of undefined (reading 'toLowerCase')` in notes filter (`da2a855`)
- Reimplemented cleanly (`349854e`) with proper type guards and no merging confusion

### Clinical Notes — Pagination (April 13, 2026)

#### Problem
- Clinic tab has 20 notes — showing all at once is too cluttered
- Other patients could have even more notes

#### Solution: Client-Side Pagination
- **5 notes per page** — `NOTES_PER_PAGE = 5`
- **Dynamic page count**: `Math.ceil(filteredNotes.length / 5)` — adapts to any number of notes
- **Page state**: `notePage` (starts at 1), resets to 1 when switching tabs
- **`paginatedNotes`**: `filteredNotes.slice((notePage - 1) * 5, notePage * 5)`
- **Pagination bar**: Prev / numbered page buttons / Next — only shown when `totalNotePages > 1`
- **Active page**: Blue highlight (`#2563EB`)

#### Fixed-Height Container
- **Problem**: Pagination bar position shifted up/down depending on content length of the 5 notes on each page, forcing user to hunt for the buttons
- **Fix**: Notes rendered inside `.cn-notes-list` container with `height: 520px; overflow-y: auto` — pagination bar stays pinned at the same position regardless of content

#### CSS Classes Added
- `.cn-notes-list` — Fixed height 520px, overflow-y auto, thin scrollbar
- `.cn-pagination` — Flex centered, gap 4px, padding 12px top
- `.cn-page-btn` — Border, rounded, 13px font, hover state
- `.cn-page-active` — Blue background, white text, bold

### Updated Clinical Notes Data Sources
| Tab | Data Source | Notes |
|-----|-----------|-------|
| Clinic | `GET /baseR4/DocumentReference?type.coding=11506-3` | 20 notes for Patient 1 (4 pages) |
| Care | `GET/POST /baseR4/CareCoordinationNote` | Dynamic from API (logged-in coordinator's notes) |
| Admin | `GET /baseR4/DocumentReference?type.coding=34108-1` | Dynamic from API |

### Care Tab — CareCoordinationNote API Integration (April 13, 2026)

#### API Details

**POST** `https://fhirassist.rsystems.com:8081/baseR4/CareCoordinationNote`
- Creates a new care coordination note
- Body: `{ patientId, coordinatorEmail, coordinatorName, coordinatorRole, careNotes }`
- `coordinatorName` = logged-in user's `userName` (from `cb_user`)
- `coordinatorEmail` = logged-in user's email (from `cb_email`)
- `coordinatorRole` = "Care Coordinator" (hardcoded)
- `careNotes` = text from the textarea
- Returns 201 Created with the DocumentReference resource
- Bearer token auth

**GET** `https://fhirassist.rsystems.com:8081/baseR4/CareCoordinationNote/search?patientId=<id>&coordinatorEmail=<email>`
- Fetches care notes for this patient created by the logged-in coordinator
- Returns a FHIR Bundle with DocumentReference entries
- Each entry: `author[0].display` (name), `author[0].extension` (url contains "coordinator-role" → valueString), `description` (note text), `date`
- No base64 content — full note text is in `description` field directly

#### Implementation

**`auth.js`** — Login now stores `cb_email` in `localStorage`:
- `localStorage.setItem('cb_email', email)` added after token and name storage
- User must log out and log back in once for this to take effect

**`DashboardPage.jsx`**:
- **New state**: `careDocNotes` — care notes fetched from CareCoordinationNote API
- **`userEmail`**: Read from `localStorage.getItem('cb_email')`
- **`fetchCareNotes(pid)`**: Async function that GETs care notes from API, parses author name, role (from extension url containing "coordinator-role"), note text (from `description`), date. Sorts newest-first
- **Called on dashboard load**: If `userEmail` exists, `fetchCareNotes(patientId)` fires alongside other fetches
- **`careNotes` computed**: Uses `careDocNotes` (API data) if available, falls back to local `addedNotes` state
- **`handleAddNote`**: Now async — POSTs to `/baseR4/CareCoordinationNote`, then calls `fetchCareNotes()` to refresh. Falls back to local state if POST fails
- **Page reset**: `setNotePage(1)` called after adding a note

#### Response Structure (per CareCoordinationNote entry)
- `author[0].display` → Coordinator name (e.g., "hbisth", "Harshit")
- `author[0].extension` (url contains "coordinator-role") → `valueString` (e.g., "Care Coordinator")
- `author[0].identifier.system` → "mailto", `.value` → coordinator email
- `description` → Full note text (not base64, plain text)
- `date` → Creation timestamp

### All Clinical Notes Tabs — Final State (April 13, 2026)

| Tab | Data Source | Method | Notes |
|-----|-----------|--------|-------|
| Clinic | `/baseR4/DocumentReference?type.coding=11506-3` | GET | All clinical notes for patient |
| Care | `/baseR4/CareCoordinationNote` | GET + POST | Logged-in coordinator's notes only |
| Admin | `/baseR4/DocumentReference?type.coding=34108-1` | GET | All admin notes for patient |

**All three Clinical Notes tabs are now fully dynamic with API integration. No static/mock data remains.**

### Git Commit History (continued)
44. `0a6056f` — Update notes.md with review API integration details
45. `bbeb101` — Integrate review APIs: GET review status, POST mark as reviewed, 1-week expiry logic
46. `d405115` — Remove All and Admin tabs from Clinical Notes (reverted)
47. `cad9731` — Revert clinical notes tabs - restore All, Clinic, Care, Admin
48. `eadfe8d` — Remove All tab from clinical notes, show Add Note only on Care tab
49. `0955456` — Simplify Add Note modal - only textarea, author from login, role hardcoded Care Coordinator
50. `e1f7a9e` — Update notes.md with clinical notes tab and add note changes
51. `1cf25b4` — Integrate DocumentReference API (first attempt, reverted)
52. `3146a5a` — Update notes.md (reverted with code)
53. `25c48c9` — Revert DocumentReference API integration
54. `da2a855` — Fix TypeError in clinical notes filter - guard undefined type
55. `349854e` — Integrate DocumentReference API for dynamic Clinic and Admin notes tabs (clean)
56. `7662668` — Add client-side pagination to Clinical Notes - 5 per page with dynamic page numbers
57. `73233c8` — Fix notes pagination position - fixed height container so page buttons stay in place
58. `622760b` — Update notes.md with DocumentReference API integration, pagination, and fixed-height container
59. `4e4521d` — Integrate CareCoordinationNote API for Care tab - POST to create, GET to fetch notes
60. `19a6aa0` — Show first+last name only, replace emojis with image icons for DOB, phone, alerts

---

## Patient Banner & Alert Icon Updates (April 13, 2026)

### Patient Name — First + Last Only
- Drops middle name from display: "James Robert Mitchell" → "James Mitchell"
- Logic: if name has >2 parts, keeps first and last only (`nameParts[0] + nameParts[last]`)
- Initials now 2 letters (e.g., "JM" not "JRM")
- Applied in `parsePatientFromResource` function

### Image Icons Replace Emojis
| Location | Old | New |
|----------|-----|-----|
| DOB in patient banner | 📅 emoji | `/images/icon-calendar.png` |
| Phone in patient banner | 📞 emoji | `/images/icon-phone.png` |
| Medication Non-Adherence alert | 💊 emoji | `/images/icon-pill.png` |
| Missed Follow-Up Appointments alert | 📅 emoji | `/images/icon-calendar.png` |

### Files Changed
- `src/components/DashboardPage.jsx` — Name parsing, `ALERT_ICONS` map updated to use image markers, alert rendering uses `<img>` for pill/calendar, banner DOB/phone use `<img>` tags
- `src/dashboard.css` — Added `.dash-alert-img` (20x20px), `.dash-banner-icon` (18x18px, vertical-align middle)
- `public/images/icon-calendar.png`, `icon-phone.png`, `icon-pill.png` — New icon assets

---

## Early Dashboard Load — AI Runs in Background (April 13, 2026)

### Problem
- Dashboard loading screen blocked for ~11 seconds until ALL fetches (FHIR + AI analysis) completed
- The AI call to Azure OpenAI (`callAIForAnalysis`) was the bottleneck (~5-8 seconds)

### Solution
- **Split the flow**: FHIR data fetches dismiss the loading screen (~3-4s), AI runs separately in the background
- **`aiLoading` state**: New boolean, `true` while AI call is in progress
- **`loadDashboard()`**: Now only fetches FHIR data (Patient, Encounters, Observations, Medications, EpisodeOfCare, Risk Insights, DocumentReference, CareCoordinationNote). Returns `patientName` for the AI call
- **`loadAIInsights(pName)`**: New async function, runs AFTER loading screen dismisses. Fetches care gap text from `sessionStorage` (or FHIR fallback), calls `callAIForAnalysis`, sets alerts/trends/aiActions/missedAppts. Sets `aiLoading = false` when done
- **Flow**: `Promise.all([loadDashboard(), minLoadTime]).then(() => { setIsLoading(false); loadAIInsights(name) })`

### UI While AI Loads
- **Alerts & Risk Drivers section**: Shows purple spinner with "Analyzing clinical data..." text
- **AI Actions tab**: Shows purple spinner with "Generating AI recommendations..." text
- Both sections populate seamlessly once AI call completes

### CSS Added
- `.ai-loading-inline` — Flex column centered container with padding
- `.ai-loading-spinner` — 28px purple spinning ring (`border-top-color: #6366F1`, `animation: ai-spin 0.8s`)
- `@keyframes ai-spin` — Simple 360deg rotation

### Result
- Perceived load time: **~3-4 seconds** (down from ~11 seconds)
- Patient banner, Vitals, Medications, Encounters, Care Team, Clinical Notes, Clinical Trends, Risk Insights all visible immediately
- AI-dependent sections (Alerts, AI Actions) fill in after a few more seconds

---

## Phone Number US Format (April 13, 2026)

- Phone number in patient banner now displays in US format: `(XXX) XXX-XXXX`
- Strips all non-digit characters, handles 11-digit numbers with leading `1` (country code)
- Falls back to raw value if not a valid 10-digit number
- Example: `2025550185` → `(202) 555-0185`

## Banner Icon Size (April 13, 2026)

- Phone/calendar icon in patient banner increased from 14px to 18px

### Git Commit History (continued)
61. `08eef0f` — Update notes.md with CareCoordinationNote API integration and final Clinical Notes state
62. `fe50fd2` — Show dashboard early after FHIR loads, run AI analysis in background with inline spinner
63. `0cf548b` — Format phone number in US format (XXX) XXX-XXXX
64. `fe7dff4` — Increase patient banner phone icon size from 14px to 18px

---

## Session: April 14, 2026

### Icon Replacements — Emojis to Images/SVGs

#### Tab Icons — PNG to Inline SVG Fix
- **Problem**: PNG images (`icon-trends.png`, `icon-task.png`, `icon-outreach.png`) with `filter: brightness(0) invert(1)` turned into solid white blobs on the active (purple) tab — the filter filled the entire transparent PNG white
- **Fix**: Replaced all 3 tab icons with **inline SVGs** using `stroke="currentColor"` — they automatically inherit the text color (dark when inactive, white when active)
- Clinical Trends: line chart SVG (`<path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 6-6"/>`)
- Task Queue: clipboard with checkmark SVG
- Patient Outreach: people group SVG
- Removed `.dash-tab-icon` and `.dash-tab.active .dash-tab-icon { filter }` CSS rules
- Added `.dash-tab svg { flex-shrink: 0; }` CSS
- Commit: `faea4e2`

#### Task Queue — Calendar Emoji to Image
- Replaced `📅` emoji next to "DUE:" in task cards with `icon-calendar.png` (same as AI Actions and Appointments)
- Commit: `edd119a`

#### Patient Outreach — All Icons Replaced
- **Phone Call card**: Header icon → `icon-phone.png` (28px), button icon → inline SVG phone (14px, white)
- **SMS Message card**: Header icon → inline SVG chat bubble (`stroke="#475569"`, 28px), button icon → inline SVG chat bubble (14px, white)
- **Email Portal card**: Header icon → inline SVG envelope (`stroke="#475569"`, 28px), button icon → inline SVG envelope (14px, white)
- **"Send to Patient" button**: Background changed from red (`#dc2626`) to white with border, icon (`📤`) removed
- **"Save as Template" button**: Unchanged (already white with border), icon (`📋`) removed
- Commit: `76a164f`

### AI-Generated Outreach Message — TRIED & REVERTED
- **Implemented**: Lightweight LLM call (`gpt-4.1-mini`) to generate personalized outreach message based on patient's clinical alerts and recommended actions
- **How it worked**: After `callAIForAnalysis` completed, a second LLM call generated the outreach message. Textarea showed spinner "Generating personalized message..." then populated with AI content. Used `key` prop to re-render textarea when message arrived
- **Reverted**: User decided to keep the static template. All outreach AI code removed (state `outreachMessage`, LLM call, spinner)
- **Current state**: Static template with dynamic patient first name only

### Model Switch — TRIED & REVERTED
- Tried switching all 3 dashboard `gpt-4.1-mini` calls to `gpt-5.4-nano-2026-03-17`
- User tested, didn't like the results
- Reverted back to `gpt-4.1-mini` for dashboard calls

### AI Loading Speed Optimization — TRIED & REVERTED
- **Problem**: Inline spinners (Alerts & AI Actions) took ~18 seconds
- **Attempted fix**: 
  1. Set `aiLoading = false` after main AI call (before outreach)
  2. Switched `callAIForAnalysis` from streaming to non-streaming
  3. Reduced `max_tokens` from 3500 to 2000
  4. Outreach message as fire-and-forget (non-blocking)
- **Reverted**: Not working as expected
- **Manager feedback**: Loading time is not a problem, no further optimization needed

### Hard Reset to `76a164f`
- After multiple model switches and reverts, user requested a clean reset
- `git reset --hard 76a164f` + force push — returned to clean state after Patient Outreach icon changes
- All intermediate commits (AI outreach, model switches, speed optimization) discarded

### Models Used (Current State)
| Model | Where | Purpose |
|-------|-------|---------|
| **gpt-5.4-nano-2026-03-17** | Chatbot (`openai.js`) | Main chatbot — conversations, FHIR tool calling, care gap analysis |
| **gpt-4.1-mini** | Dashboard (`DashboardPage.jsx`) — 2 places | 1. `callAIForAnalysis` — extracts alerts, trends, AI actions from care gap text |
| | | 2. Fallback actions — generates 2 new actions when all are approved |

### Coordinator Email — URL Parameter (IMPLEMENTED)
- **Before**: `coordinatorEmail` for Care tab APIs was read from `localStorage` (`cb_email`)
- **After**: Email is passed in the dashboard URL and read from URL params
- **`ChatWidget.jsx`**: Reads `cb_email` from `localStorage`, appends to dashboard URL
- **`DashboardPage.jsx`**: Reads email from URL param first, falls back to `localStorage`
- Used in Care tab POST (`/baseR4/CareCoordinationNote`) and GET (`/baseR4/CareCoordinationNote/search`)
- Commit: `7feb6e3`

### Base64 URL Encoding (IMPLEMENTED)
- **Problem**: Patient ID and coordinator email were exposed as plain text in the URL:
  `/dashboard?patient=a3f8b2c1-...&email=rishabh.raj@rsystems.com`
- **Solution**: Encode both values into a single Base64 `d` parameter
- **Encoding** (`ChatWidget.jsx`): `btoa(patientId + '|' + email)` → single `d` param
- **Decoding** (`DashboardPage.jsx`): `atob(d)` → split by `|` → `[patientId, email]`
- **URL now looks like**: `/dashboard?d=YTNmOGIyYzEtN2Q0ZS...`
- **Backward compatible**: Still supports old `?patient=...&email=...` format as fallback
- **Dynamic**: Every combination of patient + logged-in user produces a unique encoded URL
- Commit: `23cfc08`

### Git Commit History (this session)
65. `ebf195d` — Replace emojis with image icons: due date calendar, notes clock, appointment date/time, tab icons for trends/task/outreach
66. `faea4e2` — Fix tab icons: replace PNG images with inline SVGs that inherit text color naturally
67. `edd119a` — Replace calendar emoji with icon-calendar.png in Task Queue due dates
68. `76a164f` — Patient Outreach: replace emojis with inline SVGs for phone/sms/email, simplify Send to Patient button
69. `a2d3f1a` — Generate personalized outreach message via AI (REVERTED)
70. `14cb830` — Switch dashboard AI to gpt-5.4-nano (REVERTED)
71. `ffbc512` — Revert dashboard AI back to gpt-4.1-mini (REVERTED)
72. `5c9d549` — Speed up dashboard AI (REVERTED)
73. `7d2ea4b` — Revert speed optimization (REVERTED)
74. `1bd5244` — Revert AI-generated outreach message (REVERTED)
75. **Hard reset to `76a164f`** — discarded commits 69-74
76. `07a7dfb` — Trigger redeploy
77. `0af9ead` — Switch dashboard AI calls to gpt-5.4-nano-2026-03-17
78. `7feb6e3` — Pass coordinator email via URL param
79. `23cfc08` — Encode patient ID and email in Base64 URL param
80. `43a2d39` — Update notes.md with April 14 session
81. `538d14a` — Show Launch CareCord AI button only when patient is known and full care gap response is delivered

### Launch CareCord AI Button — Conditional Display (IMPLEMENTED)
- **Problem**: "Launch CareCord AI" button appeared whenever the user mentioned "care gaps" — even if the chatbot didn't know which patient yet (e.g., bot asks "could you please provide the patient's name" and the button still showed)
- **Fix**: Button now only appears when ALL three conditions are met:
  1. **Patient is known** — `currentPatientRef.current?.id` exists
  2. **Response is substantial** — `finalText.length > 500` (full care gap analysis, not a short question)
  3. **Not a clarification question** — response doesn't contain "could you please provide" or "which patient"
- **File**: `src/components/ChatWidget.jsx`
- **Variable**: `hasCareGapContent` replaces the old `isCareGap` for `showCareCordBtn` and `sessionStorage` caching
- **sessionStorage caching**: Also gated by same conditions — care gap text only cached when actual content is present
- Commit: `538d14a`

---

## Session: April 16, 2026

### UI Batch Update — 7 Changes

#### 1. Action Chip Rename: "Plot Trends" → "Observation Trends"
- User sees "Observation Trends" in the dropdown
- Silently sends "Plot Trends" to the chatbot via `query: 'Plot Trends'`
- File: `src/components/ChatWidget.jsx`

#### 2. Dashboard Chart X-Axis: mm-dd-yy Format
- Changed from `toLocaleDateString('en-US', { month: 'short', day: 'numeric' })` to `mm-dd-yy` format (e.g., `05-05-24`)
- Font size reduced from 11px to 10px
- File: `src/components/DashboardPage.jsx` (Clinical Trends chart options)

#### 3. Dashboard Chart Tooltip: Value Only
- Changed from `"HbA1c Trend for James Robert Mitchell: 9.1"` to just `9.1`
- Tooltip title also uses mm-dd-yy date format
- File: `src/components/DashboardPage.jsx`

#### 4. Chatbot Chart: Same Date + Tooltip Fixes
- The chatbot's `ChartBlock` component had no date formatting or tooltip customization
- Added: x-axis ticks with mm-dd-yy format, 45° rotation, font size 10px
- Added: tooltip shows mm-dd-yy date as title, just the value as label
- Graceful fallback: if date can't be parsed, shows raw label
- File: `src/components/ChatWidget.jsx`

#### 5. Deteriorating Clinical Trends: Color Coding
- Values, ranges, and severity labels now separated with different colors
- **Values** (e.g., `7.8% → 9.2%`): dark text, regular weight (not bold)
- **Ranges** (e.g., `(Normal: <5.6%)`): grey text, smaller font (11px)
- **Severity labels** (CRITICAL/HIGH/MEDIUM/LOW): colored pill badges
  - CRITICAL: white text on red (`#DC2626`)
  - HIGH: white text on orange (`#EA580C`)
  - MEDIUM: dark text on yellow (`#FCD34D`)
  - LOW: white text on green (`#16A34A`)
- Parsing logic: regex extracts severity match (`↑ CRITICAL`), range match (`(Normal: ...)`), and remaining value
- CSS classes: `.dash-trend-val`, `.dash-trend-range`, `.dash-trend-sev`, `.sev-critical`, `.sev-high`, `.sev-medium`, `.sev-low`
- File: `src/components/DashboardPage.jsx`, `src/dashboard.css`

#### 6. Dynamic Priority Pill
- **Before**: Hardcoded `<span class="pill-red">High Priority</span>`
- **After**: Computed from care gap count (`activeGapCount` = alerts with severity !== "NONE")
  - 3 gaps → "High Priority" (red pill)
  - 2 gaps → "Medium Priority" (orange pill)
  - 0-1 gaps → "Low Priority" (green pill)
- New CSS classes: `.pill-orange` (orange bg), `.pill-green` (green bg)
- File: `src/components/DashboardPage.jsx`, `src/dashboard.css`

#### 7. Dynamic Care Gap Pill + Alert NONE State
- **Care Gap pill**:
  - Has care gaps → `⚠ Care Gap` (red outline)
  - No care gaps → `✓ No Care Gaps Detected` (green outline)
  - New CSS: `.pill-green-outline`
- **Individual alerts**:
  - AI prompt updated to allow severity `"NONE"` with detail `"No care gaps detected"` when no issue exists for a category
  - Frontend: if severity is NONE → shows "No care gaps detected" text + green "NONE" pill + dimmed styling (`.dash-alert-none { opacity: 0.6 }`)
- File: `src/components/DashboardPage.jsx`, `src/dashboard.css`

### Chatbot Chart Fixes
- **X-axis dates**: Added mm-dd-yy format with 45° rotation, font size 10px
- **Tooltip**: Title shows mm-dd-yy date, label shows just the value (not "Label: value")
- Graceful fallback: if date string can't be parsed, shows raw label
- File: `src/components/ChatWidget.jsx` (`ChartBlock` component)

### Observation Trends Action Chip — Silent Query
- User sees "Observation Trends" in dropdown
- Sends "Plot Trends" to the chatbot silently via `query: 'Plot Trends'`
- File: `src/components/ChatWidget.jsx`

### Deteriorating Clinical Trends — Color Iterations
- **Values**: Changed from black → blue (`#2563EB`) → **orange** (`#EA580C`) (user chose orange as a "negative" color)
- **Ranges**: Changed from grey → **green** (`#059669`)
- Commits: `9a09bf4` (blue→orange), `fafc0e4` (final orange)

### Patient Outreach — Email + Template Changes
- **Send Email button** (Email Portal card): Changed from `<button>` to `<a href="mailto:${pt.email}">` — opens Outlook/email client with patient's email in "To" field
- **Send to Patient button**: Also changed to `<a href="mailto:${pt.email}">` — same mailto functionality
- **Save as Template button**: Removed entirely
- File: `src/components/DashboardPage.jsx`

### Care Team — Add Logged-In User (IMPLEMENTED)
- The logged-in user is now automatically added to the **top** of the Care Team list
- Name: from `cb_user` in localStorage (formatted via `formatDisplayName`)
- Initials: auto-generated from first letters of name parts (max 2)
- Specialty/Program: "Care Coordinator"
- Email: from `cb_email` in localStorage (used for mailto link)
- **Deduplication**: Won't add if a team member with the same name already exists (case-insensitive)
- Added inside `loadDashboard()` after `parseCareTeamFromEoC` returns, before `setCareTeamData`
- File: `src/components/DashboardPage.jsx`

### Git Commit History (this session)
82. `3730e84` — UI batch: rename Observation Trends, chart date format, tooltip, color-coded trends, dynamic priority/care gap pills, alert NONE state
83. `9021f60` — Fix: Observation Trends silent query, chatbot chart dates mm-dd-yy + tooltip value only, remove bold from deteriorating trends
84. `412d950` — Update notes.md with April 16 session
85. `9a09bf4` — Deteriorating trends: blue values, green ranges
86. `fafc0e4` — Deteriorating trends values: change from blue to orange
87. `704e804` — Outreach: Send Email opens mailto with patient email, remove Save as Template; Care Team: add logged-in user as Care Coordinator
88. `682c892` — Update notes.md with chart fixes, trend colors, outreach email, care team logged-in user
89. `15a6314` — Med/encounter pill colors, Task Queue Add Note to Care tab, remove Care tab Add Note button
90. `1e7caf2` — Fix: only Missed pill is red, not the whole encounter row
91. `15784f3` — Care tab task notes: structured layout with Task, Status, Note on separate lines

---

## Session: April 16, 2026 (continued)

### Medication Pill Colors
- **Active** → green (`#16A34A`, `.pill-active`)
- **Stopped / Discontinued** → red (`#DC2626`, `.pill-stopped`)
- **Completed** → grey (`#64748B`, `.pill-completed-grey`)
- **On-hold** → yellow/amber (unchanged, `.pill-onhold`)
- Status class logic updated: `statusClass` function now checks lowercase status for all variants
- File: `src/components/DashboardPage.jsx`, `src/dashboard.css`

### Encounter Pill Colors
- **Completed** → grey (`#64748B`, `.pill-completed`)
- **Upcoming** → blue (`#2563EB`, `.pill-upcoming`)
- **Stopped** → red (`#DC2626`, `.pill-stopped`) — only the pill, not the entire row
- **Missed** → red pill only (`.pill-missed`) — removed the red left border and pink background from the entire row (`.dash-appt-row.missed` CSS rule removed, `missed` class no longer applied to the row div)
- Added `stopped` as a valid `apptStatus` derived from FHIR `status === 'stopped'`
- File: `src/components/DashboardPage.jsx`, `src/dashboard.css`

### Clinical Notes — Remove Add Note from Care Tab
- Removed the `+ Add Note` button that appeared when `noteFilter === 'coordination'`
- Removed the entire Add Note modal (header, textarea, cancel/confirm buttons)
- The `handleAddNote` function and related state (`showAddNoteModal`, `newNote`) still exist but are unused (kept for potential future API integration)
- File: `src/components/DashboardPage.jsx`

### Task Queue — AI NOTES + User Notes → Care Tab
- **Renamed**: "NOTES:" label → "AI NOTES:" in each task card
- **New UI**: Below AI NOTES, added a "Notes:" section with:
  - A `<textarea>` for free-text input (placeholder: "Add a note...")
  - An "Add Note" button (blue, disabled when text is empty)
- **State**: Two new state variables:
  - `taskNoteTexts` — `{ [taskId]: string }` — tracks text input per task
  - `taskCareNotes` — array of care note objects created from task notes
- **`handleTaskAddNote(taskId, taskTitle, taskStatus)`**:
  - Creates a care note object with `taskId`, `taskTitle`, `taskStatus` label, note `text`, author info, and date
  - Appends to `taskCareNotes` state
  - Clears the text input for that task
- **Care Tab integration**: `careNotes` array now merges API-fetched notes + `taskCareNotes`, sorted by date (newest first)
- **No API** — notes are local state only (will be migrated to API when backend DELETE endpoint is available)
- File: `src/components/DashboardPage.jsx`, `src/dashboard.css`

### Task Status Change — Remove Old Care Notes
- When `updateTaskStatus(taskId, newStatus)` is called (Start Task / Mark Complete), all care notes with matching `taskId` are removed from `taskCareNotes` state
- This means: if a note was added during "Pending" status and the task moves to "In Process", that pending note is deleted from the Care tab
- Logic: `setTaskCareNotes(prev => prev.filter(n => n.taskId !== taskId))`
- File: `src/components/DashboardPage.jsx`

### Care Tab Task Notes — Structured Layout
- **Before**: Notes displayed as a single line: `[Task: ...] [Status: ...] note text`
- **After**: Notes display in a structured card with blue left accent border:
  - **Task:** title on its own line (bold label)
  - **Status:** status on its own line (bold label)
  - **Note:** user's note text on its own line (bold label)
- CSS: `.dash-note-task-info` (container with `#F8FAFC` bg, `3px solid #2563EB` left border), `.dash-note-task-row`, `.dash-note-task-label`
- Regular (non-task) care notes still render as plain text paragraphs
- File: `src/components/DashboardPage.jsx`, `src/dashboard.css`

### CSS Changes Summary
```css
/* New classes added */
.pill-stopped { background: #FEE2E2; color: #DC2626; }
.pill-completed-grey { background: #F1F5F9; color: #64748B; }
.pill-upcoming { background: #DBEAFE; color: #2563EB; }  /* changed from green */
.pill-completed { background: #F1F5F9; color: #64748B; }  /* changed from green */
.tq-user-notes { /* container for user note input */ }
.tq-note-input { /* textarea styling */ }
.tq-add-note-btn { /* blue Add Note button */ }
.dash-note-task-info { /* structured task note card */ }
.dash-note-task-row { /* each row in task note */ }
.dash-note-task-label { /* bold label (Task:/Status:/Note:) */ }

/* Removed */
.dash-appt-row.missed { /* red border + pink bg on entire row — removed */ }
```

### Encounters — End Date Display
- Added parsing of `r.period?.end` from FHIR Encounter response
- Each encounter now stores `endDate` and `endTime` (formatted same as start)
- Rendered inline after the start date/time with an arrow separator: `📅 Oct 15 🕐 9:30 AM → 📅 Oct 15 🕐 10:15 AM 📍 Room`
- If `period.end` is absent in the API response, nothing extra is shown
- File: `src/components/DashboardPage.jsx`

### Encounters — Location Row (REVERTED)
- Briefly moved `📍 location` to its own row below the dates
- User requested revert — location stays on the same row as dates
- Commit `09c4326` (moved), reverted by `a04df92`

### Git Commit History (continued)
92. `8d08c63` — Update notes.md with med/encounter pills, task queue notes, care tab changes
93. `ee38ca4` — Encounters: show end date and end time from period.end
94. `09c4326` — Encounters: move location to its own row below dates
95. `a04df92` — Revert "Encounters: move location to its own row below dates"
96. `5f3ffb2` — Update notes.md with encounter end dates and location revert
97. `c401ce6` — AI-generated outreach message, deferred after main AI insights load
98. `3abc65d` — Pagination for medications (10/page) and encounters (10/page, no cap); rename to Medications
99. `66d4d56` — Fix: fetch all encounters and medications with size=100 to avoid pagination cutoff
100. `9ddbff6` — Fix: remove duplicate missed encounters from FHIR when AI missed appointments exist
101. `90f7c5e` — Encounters: use only FHIR API responses, remove AI-detected missed duplicates

---

## Session: April 17, 2026

### AI-Generated Outreach Message (IMPLEMENTED)
- Outreach Communication Template message is now generated by AI instead of a static template
- Uses `gpt-5.4-nano-2026-03-17` via `/api/chat`
- **Deferred loading**: Generation starts automatically AFTER main AI insights (alerts, trends, actions) finish loading (~14s), not alongside them
- Prompt includes patient name and care gaps identified by AI
- While generating, shows a spinner with "Generating personalized message..."
- Static template kept as fallback if AI call fails
- `key` prop on textarea switches between `'ai'` and `'static'` to force re-render when AI message arrives
- State: `outreachMsg` (string), `outreachLoading` (boolean)
- Function: `generateOutreachMessage(pName, careContext, aiResult)` — called inside `loadAIInsights` after `callAIForAnalysis` completes
- File: `src/components/DashboardPage.jsx`

### Medications & Encounters — Pagination
- **Medications**: Renamed from "Current Medications" to "Medications"
- Both medications and encounters now use **client-side pagination** (10 items per page)
- Pagination controls: Prev / page numbers / Next (same style as Clinical Notes `cn-pagination`)
- Replaced the old "Show All / Show Less" toggle buttons
- State: `medsPage`, `apptsPage` (both default to 1)
- File: `src/components/DashboardPage.jsx`

### Encounters — Remove 10-Record Cap
- Previously `parseEncountersFromFhir` returned only the top 10 encounters: `encounters.slice(0, 10)`
- Removed the cap — now returns ALL parsed encounters
- File: `src/components/DashboardPage.jsx`

### API Fetch — size=100 for Full Data
- Encounters and MedicationRequest API calls were only fetching `page=0` without a `size` param
- API defaults to ~10 results per page, causing data cutoff (20 encounters → 13 shown, 12 meds → 10 shown)
- Added `size=100` to both Encounter and MedicationRequest fetch calls (main load + AI fallback)
- Also added `size=100` to Observation and Condition fallback fetches
- File: `src/components/DashboardPage.jsx`

### Encounters — Duplicate Missed Appointments Fix
- **Problem**: Missed appointments were showing twice — once from AI-detected `missedAppointments` (descriptive names like "Diabetic Foot Screening") and once from FHIR Encounter API (generic name "Encounter")
- **First attempt**: Removed FHIR missed encounters, kept AI ones → user didn't like this
- **Second attempt**: Removed AI missed, kept only FHIR API responses (`[...fhirEnc]`) → user wanted to try the opposite
- **Final fix**: Show AI missed appointments (descriptive names) + FHIR non-missed encounters, hide FHIR missed duplicates
- Changed to `[...missed, ...fhirEnc.filter(e => !e.isMissed)]`
- Count in header updated to match: `fhirEnc (non-missed).length + missedAppts.length`
- File: `src/components/DashboardPage.jsx`

### Git Commit History (continued)
102. `aa9f174` — Update notes.md with April 17 session
103. `3abc65d` — Pagination for medications and encounters
104. `66d4d56` — Fix: fetch all encounters/medications with size=100
105. `9ddbff6` — Fix: remove duplicate missed encounters (attempt 1 — keep AI, remove FHIR missed)
106. `90f7c5e` — Encounters: use only FHIR API responses (attempt 2 — keep FHIR, remove AI missed)
107. `3229a5a` — Fix: encounter count uses only FHIR data
108. `8474d3b` — Encounters: show AI missed + FHIR non-missed, hide FHIR missed duplicates (final)
109. `5848517` — Update notes.md with encounter duplicate fix iterations
110. `09a6ea3` — Fix vitals units in knowledge base: body temp, heart rate, SpO2 to FHIR R4 UCUM compliant

### Vitals — Excel Data (chatbase_data.xlsx)
- Created new **"Vitals" sheet** with 25 rows (5 vitals × 5 key encounters)
- **Simplified columns** (10 instead of 15): id, patient_id, encounter_id, observation_code_id, status, value_quantity, value_unit, value_string, interpretation_code, effective_date
- **No changes to any other sheets** — Measurement_Master already had all 5 LOINC codes
- All new data has **light green background** (`#D5F5E3`) for backend team visibility
- **Reference table** at bottom with LOINC codes, UCUM units, normal ranges, FHIR category

**5 Vitals used (all from Measurement_Master):**
| Vital | Row ID | LOINC | UCUM Unit | Normal Range |
|---|---|---|---|---|
| Systolic BP | 754 | 8480-6 | mmHg | 90-120 |
| Diastolic BP | 755 | 8462-4 | mmHg | 60-80 |
| Heart Rate | 760 | 8867-4 | /min | 60-100 |
| Body Temperature | 759 | 8310-5 | [degF] | 97.8-99.1 |
| SpO2 | 763 | 59408-5 | % | 95-100 |

**5 Encounters mapped (story-consistent):**
| Date | Event | BP | HR | Temp | SpO2 |
|---|---|---|---|---|---|
| Mar 2023 | Initial DM diagnosis | 128/82 (N) | 78 (N) | 98.4 (N) | 98% (N) |
| Apr 2024 | DKA Episode | 142/90 (H) | 115 (HH) | 99.8 (N) | 92% (L) |
| Mar 2025 | Foot Infection | 160/100 (HH) | 102 (H) | 101.3 (HH) | 95% (N) |
| Aug 2025 | Uncontrolled DM | 165/105 (HH) | 96 (N) | 99.6 (N) | 94% (L) |
| Oct 2025 | Latest visit | 158/96 (HH) | 84 (N) | 98.6 (N) | 96% (N) |

### Knowledge Base — Vitals Units Fix
- File: `src/config/knowledgeBases.js`
- **LOINC_CODES** — fixed incorrect units:
  - Body Temperature (8310-5): `mEq/L` → `[degF]`
  - Heart Rate (8867-4): `mg/dL` → `/min`
  - SpO2 (59408-5): `mg/dL` → `%`
  - Systolic BP & Diastolic BP were already correct (`mm[Hg]`)
- **OBSERVATION_RANGES** — all 5 vitals already had correct ranges, added recommendation to SpO2:
  - `oxygenSaturationArterial`: added "supplemental O2 may be needed" to Low description

### Vitals — Dedicated API Integration
- **Changed**: Dashboard Vitals section now fetches from **`/baseR4/Observation/vitals/search`** instead of `/baseR4/Observation/search`
- The regular observations API (`/baseR4/Observation/search`) is **still used** for:
  - Clinical Trends charts
  - AI analysis fallback (in `loadAIInsights`)
- **No other dashboard sections were affected** — only the Vitals card
- Changes in `src/components/DashboardPage.jsx`:
  1. Added SpO2 (`59408-5`) to `OBSERVATION_NORMAL_RANGES` with range 95-100%
  2. Added new API call: `callFhirApi(buildUrl('/baseR4/Observation/vitals/search', { patient: patientId, page: 0, size: 100 }))`
  3. `parseVitalsFromFhir()` now receives `vitalsBundle` (from new API) instead of `obsBundle`
  4. Header text changed from "X observation types" to "X vitals"
- The `parseVitalsFromFhir` function is unchanged — it already handles FHIR bundle format correctly (picks latest value per LOINC code, evaluates against normal ranges)
- **Knowledge base** (`src/config/knowledgeBases.js`) already has all 5 vitals LOINC codes, units, and ranges

### Body Temperature Range — Celsius to Fahrenheit Fix
- The backend API returns Body Temperature values in **Fahrenheit** (`[degF]`), not Celsius
- `OBSERVATION_NORMAL_RANGES` for `8310-5` was in Celsius (36.1-37.2 °C), causing 99.6°F to show as wildly elevated
- Updated to Fahrenheit: `{ unit: '°F', low: 97.8, high: 99.1, normal: '97.8-99.1' }`
- File: `src/components/DashboardPage.jsx`

### Backend Vitals Data — Confirmed Working
- Backend team fixed the vitals data — all 5 vital types now returned from `/baseR4/Observation/vitals/search`
- API returns 10 entries across 5 unique LOINC codes:
  | Vital | LOINC | Latest Value | Latest Date |
  |---|---|---|---|
  | Systolic BP | 8480-6 | 160 mmHg | Mar 2025 |
  | Diastolic BP | 8462-4 | 82 mmHg | Mar 2023 |
  | Heart Rate | 8867-4 | 96 /min | Aug 2025 |
  | Body Temperature | 8310-5 | 99.60 °F | Aug 2025 |
  | SpO2 | 59408-5 | 96 % | Oct 2025 |
- Dashboard now correctly shows 5 vital cards with latest value per type

### CareCoordinationNote API Integration (Task Notes + Care Tab)
- **Replaced in-memory `taskCareNotes` state** with real API persistence
- **3 APIs integrated** on `/baseR4/CareCoordinationNote`:

**1. POST** `/baseR4/CareCoordinationNote` — Create a task note
- Called when "Add Note" is clicked in Task Queue
- Body: `patientId`, `actionId` (task ID), `coordinatorEmail`, `coordinatorName`, `status` (pending/in-process/completed), `coordinatorRole`, `careNotes`
- After POST, `fetchCareNotes()` is called to refresh Care tab

**2. GET** `/baseR4/CareCoordinationNote/search` — Fetch care notes for Care tab
- Requires all 4 params: `patientId`, `coordinatorEmail`, `actionId`, `status`
- After task queue loads, loops through each task and makes 3 GET calls per task (one per status: pending, in-process, completed)
- Results are deduplicated and merged, sorted by date descending
- Parses `recommended-action` extension as task title, `status` extension as task status
- **Initial attempt** with just `patientId` + `coordinatorEmail` (no actionId/status) returned 500 — API requires all 4 params
- Care notes fetch is triggered by `fetchTaskQueue` after tasks load (not from `loadDashboard` anymore)

**3. PATCH** `/baseR4/CareCoordinationNote` — Update note status when task status changes
- Params: `email`, `patientId`, `actionId`, `status` (the **CURRENT/OLD** status, not the new one)
- Called alongside the existing `portal/update-task` PATCH (which sends the **new** status)
- 3 possible transitions:
  - Pending → Start Task → PATCH with `status=pending`
  - Pending → Mark Complete → PATCH with `status=pending`
  - In Process → Mark Complete → PATCH with `status=in-process`
- After PATCH, both `fetchTaskQueue()` and `fetchCareNotes()` are called to refresh UI

**Cleanup:**
- Removed `taskCareNotes` state entirely
- Removed in-memory note creation logic from `handleTaskAddNote`
- Care tab notes are now fully API-driven via `careDocNotes`
- `parseCareNoteEntry` helper function extracts task title and status from FHIR extensions

**Files changed:** `src/components/DashboardPage.jsx`

### Git Commit History (continued)
111. `ea57a42` — Update notes.md with vitals Excel data and knowledge base unit fixes
112. `49b4f60` — Use dedicated vitals API for dashboard Vitals section
113. `5737265` — Update notes.md with dedicated vitals API integration
114. `84e080a` — Fix body temperature range to Fahrenheit; update notes.md
115. `03ab2a5` — Integrate CareCoordinationNote API for task notes and care tab (POST, GET, PATCH)
116. `0919f7a` — Fix: simplify care notes GET to single call (500 error fix attempt)
117. `56b6093` — Fix: fetch care notes per task with actionId and status params
118. `771ed71` — Fix: PATCH CareCoordinationNote sends current task status, not new status
119. `c8e003d` — Update notes.md with CareCoordinationNote API integration details
120. `87417d6` — Refactor CSS to match reference design: compact font sizes, spacing, and container sizing
121. `051c930` — Fix banner and subheader alignment/gaps to match reference design
122. `0233410` — Fix nav links to right side, subtitle below heading, contact 3-col grid, priority pill colors
123. `cebc710` — Update clinical notes UI: tab pills, category badge colors, card layout to match reference
124. `9f78545` — Redesign Patient Outreach tab UI to match reference: channel cards, template layout, proper CSS classes
125. `d92bebd` — Hide priority and care gap pills until AI alerts finish loading

---

## Session: CSS Refactoring to Match Reference Design (April 2026)

### Reference Project
- Path: `D:\Care Manager Screen`
- Used as a UI reference for font sizes, spacing, container sizing, and responsiveness
- **No colors were changed** — only sizing, spacing, fonts, and layout

### Global Changes
- Font family: `'Segoe UI', system-ui` → `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`
- Base font-size: added `14px` with `line-height: 1.5` on `.dash-page`
- Same font stack applied to `styles.css` global `--font` variable
- Files: `src/dashboard.css`, `src/styles.css`

### Navbar
- Height: `60px` → `48px`
- Padding: `0 32px` → `0 16px`
- Logo: `32px` → `28px`
- Title: `16px` → `15px`
- **Nav links (Care Manager, Provider, Patients)**: moved from center to **right side** — now inside `dash-nav-right` wrapper
- Nav links changed to title case (was uppercase), `11px`, `font-weight: 500`
- User info: added `border-left` separator, `11px/9px` font sizes
- Avatar: `34px` → `32px`, subtle border style
- Bell: added `padding: 6px`, `border-radius: 50%`, hover background
- File: `src/dashboard.css`, `src/components/DashboardPage.jsx`

### Sub-header / Breadcrumb
- **"Patient Profile & Care Management"** subtitle moved from sibling to **inside breadcrumb wrapper** — now renders below the heading row instead of next to it
- Breadcrumb text: `14px` → `18px` (matching reference `text-lg`)
- Quick pill buttons: `height: 36px`, purple-tinted border/text, `gap: 8px`
- File: `src/dashboard.css`, `src/components/DashboardPage.jsx`

### Patient Banner
- Avatar: `48px` → `56px` (matching reference `size-14`)
- Avatar-to-content gap: `14px` → `16px`
- Name: `16px` → `18px`, `font-weight: 500`
- Meta row gap: `4px` → `8px`
- **Contact row (DOB, Phone, Email)**: changed from `display: flex` to `display: grid; grid-template-columns: 1fr 1fr 1fr` — evenly distributed across full width
- Contact row: `border-top: 1px solid #F1F5F9` separator, `padding-top: 8px`
- File: `src/dashboard.css`

### Cards
- Padding: `20px 24px` → `16px`
- Border radius: `14px` → `8px`
- Headings: `15px/700` → `13px/500`
- Subtitles: `12px` → `10px/500`
- Grid gap: `20px` → `16px`
- Shadow: `0 1px 3px` → `0 1px 2px`

### Pills / Badges
- Font: `11px/600` → `10px/500`
- Padding: `3px 10px` → `1px 8px`

### AI Action Priority Pills — New Colors
- **High Priority**: solid orange → light red background (`#FEF2F2`) with dark red text (`#B91C1C`)
- **Medium Priority**: solid yellow → light amber background (`#FFFBEB`) with amber text (`#B45309`)
- **Low Priority**: solid blue → light gray background (`#F8FAFC`) with slate text (`#475569`)
- Matches reference `bg-red-50 text-red-700`, `bg-amber-50 text-amber-700`, `bg-slate-50 text-slate-700`

### Alerts + Risk Section
- Alert items: tighter padding `10px`, smaller fonts `11px/10px`
- Trends bar: compact `10px` fonts, `6px` gap
- Trend chips: `6px 10px` padding, `10px` font

### Vitals
- Card padding: `16px` → `12px`
- Icon container: added subtle background + border (`rgba(59,130,246,.04)`)
- Values: `20px` → `16px`
- Progress bars: `5px` → `3px` height

### Medications & Encounters
- Switched from border-bottom rows to **card-style** with `border-radius: 8px`, `border: 1px solid #F1F5F9`
- Name fonts: `14px` → `13px/500`
- Info fonts: `12px` → `11px`

### Care Team
- Card-style rows with `border-radius: 8px`
- Avatar: `40px` → `36px`
- Action buttons: borderless, hover background instead of border

### Clinical Notes
- **Tab filters**: changed from bordered buttons to **pill-style segmented control** — gray background container (`#F8FAFC`) with `padding: 4px`, `height: 32px`, `grid-template-columns: repeat(3, 1fr)`
- Active tab: white background with subtle shadow
- **Category badges** updated to match reference:
  - Clinical: `bg: #F5F3FF`, `text: #7C3AED`, `border: #EDE9FE` (purple tint)
  - Coordination: `bg: #EFF6FF`, `text: #2563EB`, `border: #DBEAFE` (blue tint)
  - Admin: `bg: #F8FAFC`, `text: #475569`, `border: #E2E8F0` (gray tint)
- Note card layout: header uses `justify-content: space-between` — avatar+author left, badge+View right
- Added `dash-note-header-left` wrapper div in JSX
- Note avatar: circle → rounded square (`border-radius: 6px`)
- Files: `src/dashboard.css`, `src/components/DashboardPage.jsx`

### Patient Outreach Tab — Full Redesign
- Replaced all inline styles with proper CSS classes (`po-channel`, `po-template`, etc.)
- **Channel cards** (Phone / SMS / Email):
  - Each has **colored border** matching theme (blue `rgba(59,130,246,.2)`, green `rgba(16,185,129,.2)`, purple `rgba(139,92,246,.2)`)
  - Icon in **colored rounded container** (`8px border-radius`, colored background)
  - Icon + title now **side-by-side** (was stacked/centered)
  - **Buttons**: each has own theme color (`#2563EB` blue, `#059669` green, `#7C3AED` purple) — was all green
  - `40px` height, `font-weight: 700`, full width
- **Outreach Template section**:
  - Proper card border, `20px` padding
  - "MESSAGE" label: `10px`, `font-weight: 900`, `uppercase`, `letter-spacing: .8px`
  - Textarea: `font-family: monospace`, `background: rgba(248,250,252,.8)`
  - **Send to Patient**: changed from white/bordered to blue filled (`#2563EB`) with send arrow icon
- Responsive: channels stack to single column on mobile
- Files: `src/dashboard.css`, `src/components/DashboardPage.jsx`

### Priority & Care Gap Pills — Loading Fix
- **Problem**: Priority pill ("High Priority") and Care Gap badge showed immediately with fallback/incorrect values while AI alerts were still loading, then jumped to correct values
- **Fix**: Wrapped both pills in `{!aiLoading && <>...</>}` — they stay hidden until AI alerts finish loading
- No flash of incorrect values anymore
- File: `src/components/DashboardPage.jsx`

### Task Queue
- Summary cards: `18px 20px` → `12px 14px` padding, `1px` border
- Task cards: tighter spacing, `13px/500` fonts
- Buttons: `6px 14px` padding, `border-radius: 6px`

### Modals
- Width: `560px` → `520px`, radius: `16px` → `12px`
- Header/body/footer padding reduced
- Font sizes reduced across all modal elements

### Risk Insights Widget
- Row padding: `10px 12px` → `8px 10px`
- Icon: `30px` → `26px`
- Name: `12px/600` → `11px/500`
- Badge: `9px` → `8px`

### Clinical Trends
- Title: `18px` → `14px/500`
- Tab pills: `13px` → `11px`, `14px` padding
- Chart area: `280px` → `240px` min-height

### Responsive
- Mobile navbar: `44px` height, `12px` padding
- Mobile cards: `12px` padding
- Task queue summary: single column on mobile
- Patient outreach channels: single column on mobile
- Banner contact: single column on mobile

---

## Alert Severity Pill Color Update

- **Change**: The "HIGH" severity pill in the Alert Triggers & Risk Drivers section (Medication Non-Adherence, Missed Follow-Up Appointments) now uses the same bold color style as the Deteriorating Clinical Trends section.
- **Before**: Used `pill-high` class — light red background (`#FEF2F2`) with dark red text (`#B91C1C`).
- **After**: Uses `sev-high` class — white text on bold orange background (`#EA580C`), matching the trend severity badges.
- Similarly, "CRITICAL" uses `sev-critical` (white on `#DC2626`) and "MEDIUM" uses `sev-medium` (dark text on yellow `#FCD34D`).
- The AI-Recommended Actions priority pills remain unchanged (soft tinted style).
- **File**: `src/components/DashboardPage.jsx` — changed `pill-${a.severity.toLowerCase()}` to `sev-${a.severity.toLowerCase()}` for alert items.

---

## Patient Outreach – Send to Patient with Subject & Body

- **Change**: The "Send to Patient" button in the Patient Outreach tab now opens the email client (Outlook) with a pre-filled subject and body, in addition to the patient's email in the "To" field.
- **Subject**: `Care Coordination Follow-Up – {Patient Name}`
- **Body**: The content of the outreach message textarea (AI-generated or manually edited).
- The textarea was converted from uncontrolled (`defaultValue`) to controlled (`value` + `onChange`) so that any edits the user makes to the message are reflected in the mailto link when "Send to Patient" is clicked.
- The `mailto:` URL uses `encodeURIComponent` for both subject and body to handle special characters.
- **File**: `src/components/DashboardPage.jsx`
- **Commit**: `5201ec5` — "Alert severity pills use bold sev colors; mailto includes subject and body"

---

## API Response Encryption / Decryption (AES-256-GCM)

- **Change**: All FHIR API responses are now encrypted by the backend. Frontend decrypts them automatically.
- **Algorithm**: AES-256-GCM (confirmed by backend team)
- **Key**: Stored in `.env` as `VITE_DECRYPT_KEY` (Base64-encoded 32-byte key). The `.env` file is gitignored.
- **Encrypted response format**:
  ```json
  { "payload": "<base64-encoded encrypted data>", "encrypted": true }
  ```
- **Decryption logic** (in `src/services/fhir.js`):
  - `decryptPayload(payloadB64)`: Decodes Base64, extracts first 12 bytes as IV/nonce, decrypts the rest (ciphertext + 16-byte auth tag) using Web Crypto API `AES-GCM`.
  - `maybeDecrypt(json)`: Checks if response has `{ encrypted: true }` — if yes, decrypts; otherwise returns as-is. This makes it backward-compatible.
  - `callFhirApi()` now auto-runs `maybeDecrypt` on every response.
  - Cached `CryptoKey` instance (`_cryptoKey`) for performance.
- **Files modified**:
  - `src/services/fhir.js` — Added `decryptPayload`, `maybeDecrypt`, `getCryptoKey`, `b64ToUint8`. Updated `callFhirApi` to auto-decrypt.
  - `src/services/auth.js` — Login response also runs through `maybeDecrypt`.
  - `src/components/DashboardPage.jsx` — All direct FHIR `fetch` calls (review status, task queue, care notes) also run through `maybeDecrypt`. Added `maybeDecrypt` to imports.
  - `.env` — Created with `VITE_DECRYPT_KEY` (gitignored).
  - `.env.example` — Template file for reference (committed).
- **Vercel deployment**: `VITE_DECRYPT_KEY` must be added as an environment variable in Vercel project settings.
- **Commits**: `4fbced3` (AES-256-CBC initial), `811cadf` (switched to AES-256-GCM)

---

## Excel Data — Lifestyle Goals & Upcoming Appointments

### lifestyle_goals sheet (new data)
- **34 rows** added: one per day from April 28, 2026 to May 31, 2026
- **Patient**: James Mitchell (`a3f8b2c1-7d4e-4a91-b6e5-9c2d1f3e8a7b`)
- **Columns**: `id`, `patient_id`, `steps`, `water_intake_glasses`, `exercise_minutes`, `schedule_start` (7 AM), `schedule_end` (11 PM)
- **Data characteristics**: Realistic for a diabetic patient — lower activity on weekends, gradual improvement trend over the month. Steps range ~3,000–10,000+, water 4–12 glasses, exercise 0–60 min.
- **Background**: Light green (`#C6EFCE`) to distinguish from old data.

### appointment sheet (5 new upcoming appointments)
- All with `status: booked`, dates from June–September 2026
- **Background**: Light blue (`#BDD7EE`) to distinguish from old data.

| Date | Type | Description | Practitioner |
|------|------|-------------|-------------|
| Jun 10, 2026 | Endocrinology | DM quarterly follow-up & HbA1c review | Dr. Sarah Chen |
| Jun 25, 2026 | Wound Care | Diabetic foot wound reassessment | Dr. Patricia Hoffman |
| Jul 15, 2026 | Internal Medicine | Nephropathy & neuropathy monitoring | Dr. Michael Brooks |
| Aug 5, 2026 | Endocrinology | DM comprehensive mid-year review with lipid panel | Dr. Sarah Chen |
| Sep 1, 2026 | Endocrinology | DM quarterly follow-up & insulin adjustment | Dr. Sarah Chen |

- No other sheets were modified — only `lifestyle_goals` and `appointment`.
- Script used: `add_lifestyle_appointments.py`

---

## Appointments & Encounters — Tabbed UI with Appointment API

### Overview
The "Appointments & Encounters" section in the dashboard has been split into two tabs: **Encounters** and **Appointments**.

### Encounters tab (default)
- Uses `/baseR4/Encounter` API (unchanged)
- Shows only non-missed encounters (missed/cancelled entries removed from this tab)
- Pagination: 10 per page

### Appointments tab (new)
- Calls **Appointment API** (`/baseR4/Appointment`) with `patient` and `page=0&size=100`
- Also includes **AI-analysed missed appointments** (moved from Encounters tab)
- **Deduplication**: Uses `date + location` matching to prevent duplicate missed entries (API vs AI). API results take priority.
- **Status determination** based on today's date:
  - `booked` + future date → **Upcoming** (blue pill)
  - `fulfilled` → **Completed** (green pill)
  - `noshow` → **Missed** (red pill)
  - `cancelled` → **Stopped** (red pill)
- Sorted: Upcoming first, then Missed, then Completed
- Pagination: 10 per page

### Appointment API response parsing
- **Location**: Extracted from `extension` array (`url: "Location"`, `valueString`), not from `participant`
- **Service type**: Reads `serviceType[0].text` first, falls back to `coding[0].display`
- **Reason code**: Reads `reasonCode[0].text` first, falls back to `coding[0].display`
- **Title**: Uses `description` field from the response

### Header count
- Shows deduped count (same `date + location` logic) so the number matches actual displayed items.

### State variables added
- `apptData` — Parsed appointment data from API
- `encApptTab` — Active tab (`'encounters'` or `'appointments'`)
- `apptPageNum` — Pagination state for Appointments tab

### CSS added (in `src/dashboard.css`)
- `.dash-enc-appt-tabs` — Flex container for tab buttons
- `.dash-enc-appt-tab` — Tab button styling with purple active underline indicator

### Files modified
- `src/components/DashboardPage.jsx` — New `parseAppointmentsFromFhir()` function, Appointment API call, tabbed UI, dedup logic
- `src/dashboard.css` — Tab styles
- **Commits**: `882eef5`, `8435a3c`, `d2f1601`, `bfb81c2`

### Important notes for future agents
- The **Encounter API** and **Appointment API** are separate FHIR resources with different IDs, statuses, and data structures. They represent the same events from two perspectives (clinical vs scheduling).
- The **chatbot** also uses the Appointment API via `search_patient_appointment` in `src/services/fhir.js` → `executeTool`.
- The AI-analysed missed appointments come from the LLM parsing of clinical data (generated in `summarizeFhirData`), not from the Appointment API directly.

---

## Auto-Logout (30-Minute Session Expiry)

### Overview
Implemented automatic logout after 30 minutes to synchronize with the backend bearer token expiry. Once the session expires, the user is redirected to the login page with an alert message.

### How it works
1. **On login** (`doLogin` in `src/services/auth.js`): stores `cb_login_ts` (current timestamp) in `localStorage`.
2. **Session helper functions** (exported from `src/services/auth.js`):
   - `isSessionExpired()` — returns `true` if 30 minutes have elapsed since `cb_login_ts`.
   - `clearSession()` — removes `cb_token`, `cb_user`, `cb_email`, and `cb_login_ts` from `localStorage`.
   - `getTimeUntilExpiry()` — returns remaining milliseconds until session expires (minimum 0).
3. **`SessionGuard` component** (in `src/App.jsx`): wraps all routes.
   - On mount, checks `isSessionExpired()`. If expired, clears session and redirects to `/`.
   - Sets a `setTimeout` for `getTimeUntilExpiry()` milliseconds — when it fires, clears session, shows `alert("Session expired. Please log in again.")`, and redirects to login.
   - Cleanup: clears the timer on unmount or route change.
4. **Initial load check**: `MainApp`'s `useEffect` also calls `isSessionExpired()` to catch stale sessions on first render.

### Constants
- `SESSION_TIMEOUT_MS = 30 * 60 * 1000` (30 minutes)

### localStorage keys used
- `cb_login_ts` — timestamp of last successful login (stored as string via `Date.now().toString()`)

### Files modified
- `src/services/auth.js` — Added `cb_login_ts` storage in `doLogin`, added `isSessionExpired`, `clearSession`, `getTimeUntilExpiry` exports
- `src/App.jsx` — Added `SessionGuard` component, imported session functions, wrapped routes
- **Commit**: `f679e3c`

---

## 3 New Patients — Data Generation (April 30, 2026)

### Overview
Created 3 new patients in `chatbase_data.xlsx` via `generate_3patients.py`. Each patient has data across all 29 sheets with unique background colours for identification.

### Background Colours
- **Patient 3 (Margaret Reynolds)**: Light purple (`#E8DAEF`)
- **Patient 4 (Robert Anderson)**: Light orange (`#FDEBD0`)
- **Patient 5 (William Crawford)**: Light pink (`#FADBD8`)
- (James Mitchell = no colour, Sarah Cooper = yellow `#FFFF99`)

---

## Patient 3 — Margaret Ann Reynolds

- **Patient UUID**: `c7d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f`
- **MRN**: `MRN-20230312-003`
- **DOB**: 12-Mar-1966 (age ~60)
- **Gender**: Female
- **Marital Status**: Married
- **Language**: English
- **Disease**: Essential Hypertension
- **Primary Practitioner**: Dr. Rachel Kim (Cardiology)
- **Managing Organization**: Triangle Cardiology & Vascular Center
- **Time Span**: March 2023 — March 2026 (3 years)
- **Encounters**: 20 total (3 IMP + 15 AMB + 2 cancelled no-show)

### Clinical Story
- Mar 2023: Initial HTN diagnosis (BP 158/96) during routine checkup with Dr. Brooks
- Jun 2023: Started Amlodipine 5mg + HCTZ 25mg
- Sep 2023: LDL elevated (168), started Atorvastatin 20mg
- Jan 2024: **CARE GAP — missed appointment (no-show)**
- Jun 2024: Cardiology consult with Dr. Kim, increased Amlodipine to 10mg, ECG shows early LVH
- Aug 2024: Added Losartan 50mg (3-drug regimen)
- Oct 2024: **CARE GAP — self-discontinued HCTZ** due to frequent urination
- Oct 2024: Echo confirms concentric LVH, LVEF 55% (IMP)
- Jan 2025: Hypertensive urgency (BP 198/115), ER admission (IMP), restarted HCTZ
- Apr 2025: CKD Stage II detected — creatinine 1.6, eGFR 55
- Jun 2025: Nephrology consultation with Dr. Patel
- Jul 2025: **CARE GAP — missed cardiology follow-up (no-show)**
- Jan 2026: Brief admission for accelerated HTN (BP 186/108) (IMP)
- Mar 2026: Latest visit — BP 138/84, stable on 4-drug regimen

### Conditions (ICD-9 codes, condition_code_id from Condition_Master)
- 4019 (row_id=4304) — Essential Hypertension
- 4010 (row_id=4302) — Malignant Hypertension
- 2720 (row_id=2743) — Pure Hypercholesterolemia
- 2724 (row_id=2747) — Hyperlipidemia
- 4293 (row_id=4491) — Cardiomegaly / LVH
- 40390 (row_id=4315) — Hypertensive CKD
- 5852 (row_id=5910) — CKD Stage II

### Observations (7 unique types)
| observation_code_id | Label | LOINC |
|---|---|---|
| 754 | Systolic BP | 8480-6 |
| 755 | Diastolic BP | 8462-4 |
| 113 | Creatinine | 2160-0 |
| 172 | Potassium | 2823-3 |
| 184 | Sodium | 2951-2 |
| 106 | Cholesterol LDL | 2090-9 |
| 121 | eGFR | 33914-3 |

### Procedures (CPT codes)
93306 (Echo TTE), 93000 (ECG), 99223 (Hospital visit high), 80053 (CMP), 99232 (Hospital visit moderate)

### Medications
- Amlodipine 5mg → 10mg (active), HCTZ 25mg (stopped then restarted), Losartan 50mg (active), Atorvastatin 20mg (active), Aspirin 81mg (active)
- **Care gap**: HCTZ self-discontinued — note: "Care gap — patient self-discontinued HCTZ due to frequent urination"

### Allergies
- ACE Inhibitor (dry cough) — low criticality
- Penicillin (skin rash, urticaria) — high criticality

### Episodes of Care (3 programs)
- Hypertension Disease Management Program (active) — CM: Diana Foster (Cardiovascular CM)
- Cardiovascular Risk Reduction Program (active) — CM: Catherine Williams (Primary CM)
- CKD Monitoring Program (active) — CM: Diana Foster (Cardiovascular CM)

---

## Patient 4 — Robert James Anderson

- **Patient UUID**: `d8e3f4a5-6b7c-8d9e-0f1a-2b3c4d5e6f7a`
- **MRN**: `MRN-20230822-004`
- **DOB**: 22-Aug-1971 (age ~55)
- **Gender**: Male
- **Marital Status**: Married
- **Language**: English
- **Disease**: Type II Diabetes with Hypertension
- **Primary Practitioner**: Dr. Michael Brooks (Internal Medicine) — SHARED with P3
- **Managing Organization**: (existing Internal Medicine org)
- **Time Span**: March 2023 — March 2026 (3 years)
- **Encounters**: 22 total (4 IMP + 16 AMB + 2 cancelled no-show)

### Clinical Story
- Mar 2023: DM Type II diagnosed (HbA1c 8.2, fasting glucose 185), BP 148/92
- May 2023: Started Metformin 500mg + Lisinopril 10mg
- Jul 2023: Started Amlodipine 5mg for HTN
- Sep 2023: Added Atorvastatin for hyperlipidemia (LDL 155)
- Nov 2023: Increased Metformin to 1000mg
- Jan 2024: Retinal exam — no diabetic retinopathy
- Jun 2024: **CARE GAP — missed appointment (no-show)**
- Aug 2024: HbA1c worsened to 8.5, non-compliance suspected
- Nov 2024: **CARE GAP — self-discontinued Metformin 1000mg** (GI side effects). Hospitalized for hyperglycemia (glucose 380), started Insulin Glargine (IMP)
- Feb 2025: Neuropathy symptoms, started Gabapentin 300mg
- May 2025: **CARE GAP — missed appointment (no-show)**
- Jul 2025: Hypoglycemic episode (glucose 38), ER visit (IMP)
- Sep 2025: Renal function declining — creatinine 1.5, eGFR 52, nephrology consult
- Oct 2025: Brief admission for BP spike 182/108 (IMP)
- Mar 2026: Latest — HbA1c 7.4, BP 136/82, CKD Stage II stable

### Conditions (ICD-9 codes)
- 25000 (row_id=1591) — DM Type II
- 25002 (row_id=1593) — DM Type II uncontrolled
- 4019 (row_id=4304) — Essential Hypertension
- 2724 (row_id=2747) — Hyperlipidemia
- 25062 (row_id=2265) — DM with neuropathy
- 25040 (row_id=1680) — DM with renal manifestations
- 25050 (row_id=2259) — DM with ophthalmic
- 2510 (row_id=2279) — Hypoglycemic coma

### Observations (7 unique types)
| observation_code_id | Label | LOINC |
|---|---|---|
| 53 | HbA1c | 4548-4 |
| 132 | Glucose | 2345-7 |
| 113 | Creatinine | 2160-0 |
| 172 | Potassium | 2823-3 |
| 754 | Systolic BP | 8480-6 |
| 755 | Diastolic BP | 8462-4 |
| 108 | Cholesterol Total | 2093-3 |

### Procedures
99223 (Hospital visit high), 80053 (CMP), 99222 (Hospital visit moderate), 93000 (ECG), 99232 (Hospital visit moderate)

### Medications
- Metformin 500mg (active), Metformin 1000mg (stopped — care gap), Lisinopril 10mg (active), Amlodipine 5mg (active), Atorvastatin 20mg (active), Insulin Glargine (active), Gabapentin 300mg (active)
- **Care gap**: Metformin 1000mg self-discontinued — note: "Care gap — patient self-discontinued Metformin 1000mg due to GI side effects"

### Allergies
- Sulfonamide (skin rash) — high criticality
- Shellfish (angioedema, urticaria) — high criticality
- Iodine contrast dye (mild flushing) — low criticality

### Episodes of Care (4 programs)
- Diabetes Disease Management Program (active) — CM: Sandra Mitchell (Endocrine CM)
- Hypertension Monitoring Program (active) — CM: Diana Foster (Cardiovascular CM)
- Diabetic Neuropathy Pain Management (active) — CM: Sandra Mitchell (Endocrine CM)
- CKD Monitoring Program (active) — CM: Catherine Williams (Primary CM)

---

## Patient 5 — William Thomas Crawford

- **Patient UUID**: `e9f4a5b6-7c8d-9e0f-1a2b-3c4d5e6f7a8b`
- **MRN**: `MRN-20230115-005`
- **DOB**: 15-Jan-1961 (age ~65)
- **Gender**: Male
- **Marital Status**: Widowed
- **Language**: English
- **Disease**: Lung Cancer with COPD
- **Primary Practitioner**: Dr. Sophia Garcia (Oncology)
- **Managing Organization**: Raleigh Oncology & Pulmonary Institute
- **Time Span**: March 2023 — March 2026 (3 years)
- **Encounters**: 25 total (6 IMP + 17 AMB + 2 cancelled no-show)

### Clinical Story
- Mar 2023: COPD diagnosed (FEV1 65% predicted), 40 pack-year smoker, started Tiotropium + Albuterol
- Jun 2023: COPD exacerbation, hospitalization (IMP), added Fluticasone/Salmeterol
- Dec 2023: CT thorax — suspicious 2.3cm spiculated nodule in RUL
- Jan 2024: Bronchoscopy + biopsy → NSCLC adenocarcinoma Stage IIIA (IMP)
- Mar-Oct 2024: 6 cycles Carboplatin + Paclitaxel chemotherapy
- May 2024: WBC dropped to 3.2 (neutropenia risk)
- Jul 2024: **CARE GAP — missed chemo appointment (no-show)**
- Aug 2024: Pleural effusion, thoracentesis (IMP) — malignant cells found
- Nov 2024: CT shows 40% tumor reduction (partial response)
- Dec 2024: Started Pembrolizumab immunotherapy
- Feb 2025: **CARE GAP — self-discontinued Tiotropium** (felt not helping)
- Apr 2025: Pneumonia + COPD exacerbation (IMP), restarted Tiotropium
- Sep 2025: CT stable disease on immunotherapy
- Nov 2025: **CARE GAP — missed oncology follow-up (no-show)**
- Dec 2025: Symptomatic anemia (Hgb 8.8), transfusion admission (IMP)
- Mar 2026: Latest — stable disease, Hgb 10.2, ongoing Pembrolizumab, COPD managed

### Conditions (ICD-9 codes)
- 496 (row_id=5123) — COPD
- 3051 (row_id=2899) — Tobacco use disorder
- 49322 (row_id=5105) — COPD exacerbation
- 1628 (row_id=1325) — Mal neo bronchus/lung NEC
- 1505 (row_id=1195) — Lung Cancer
- 5119 (row_id=5150) — Pleural effusion
- 2859 (row_id=3147) — Anemia NOS
- 486 (row_id=5528) — Pneumonia

### Observations (7 unique types)
| observation_code_id | Label | LOINC |
|---|---|---|
| 763 | SpO2 | 59408-5 |
| 422 | Hemoglobin | 718-7 |
| 113 | Creatinine | 2160-0 |
| 172 | Potassium | 2823-3 |
| 756 | WBC / Leukocytes | 6690-2 |
| 465 | Platelet Count | 777-3 |
| 155 | LDH | 2532-0 |

### Procedures
94010 (Spirometry PFT), 99222/99223/99232/99233 (Hospital visits), 31625 (Bronchoscopy with biopsy), 71260 (CT Thorax), 80053 (CMP)

### Medications
- Tiotropium 18mcg (stopped then restarted — care gap), Albuterol 90mcg PRN (active), Fluticasone/Salmeterol 250-50 (active), Carboplatin (completed), Paclitaxel (completed), Pembrolizumab (active)
- **Care gap**: Tiotropium self-discontinued — note: "Care gap — patient self-discontinued Tiotropium, felt it was not helping"

### Allergies
- Codeine (nausea, vomiting, confusion) — high criticality
- Cisplatin (severe nephrotoxicity) — high criticality (Carboplatin used instead)

### Episodes of Care (3 programs)
- Lung Cancer Treatment Program (active) — CM: Thomas Lee (Oncology CM)
- COPD Disease Management Program (active) — CM: Thomas Lee (Oncology CM)
- Supportive Care & Symptom Management (active) — CM: Catherine Williams (Primary CM)

---

## New Staff Added (Practitioner Sheet)

### New Practitioners (Doctors)
| Name | Specialty | Shared Across | UUID Prefix |
|---|---|---|---|
| Dr. Rachel Kim | Cardiology | P3, P4 | f1a2b3c4 |
| Dr. James Morrison | Pulmonology | P5 | a2b3c4d5 |
| Dr. Sophia Garcia | Oncology | P5 | b3c4d5e6 |

### New Care Coordinators
| Name | Specialty | Shared Across | UUID Prefix |
|---|---|---|---|
| Natalie Thompson | Hypertension Care Coordinator | P3, P4 | c4d5e6f7 |
| Mark Rodriguez | Oncology Care Coordinator | P5 | d5e6f7a8 |

### New Care Managers (NEW role type)
| Name | Specialty | Shared Across | UUID Prefix |
|---|---|---|---|
| Catherine Williams | Primary Care Manager | P3, P4, P5 | e6f7a8b9 |
| Diana Foster | Cardiovascular Care Manager | P3, P4 | f7a8b9c0 |
| Sandra Mitchell | Endocrine Care Manager | P4 | a8b9c0d1 |
| Thomas Lee | Oncology Care Manager | P5 | b9c0d1e2 |

### Existing Practitioners Reused
- **Dr. Michael Brooks** (Internal Medicine) — primary for P3, P4
- **Dr. David Patel** (Nephrology) — P3 (CKD), P4 (diabetic nephropathy)

### New Organisations
- **Triangle Cardiology & Vascular Center** (`a1b2c3d4-...`) — for P3
- **Raleigh Oncology & Pulmonary Institute** (`b2c3d4e5-...`) — for P5

---

## New Medications Added (medication_code_master)

| ID | Code Display | Used By |
|---|---|---|
| 12 | Amlodipine 5 MG Oral Tablet | P3, P4 |
| 13 | Amlodipine 10 MG Oral Tablet | P3 |
| 14 | Hydrochlorothiazide 25 MG Oral Tablet | P3 |
| 15 | Losartan 50 MG Oral Tablet | P3 |
| 16 | Tiotropium 18 MCG Inhalation Capsule | P5 |
| 17 | Albuterol 90 MCG/ACT Inhalation Aerosol | P5 |
| 18 | Fluticasone-Salmeterol 250-50 MCG Inhalation | P5 |
| 19 | Carboplatin 150 MG/15 ML Injection | P5 |
| 20 | Paclitaxel 100 MG/16.7 ML Injection | P5 |
| 21 | Pembrolizumab 100 MG/4 ML Injection | P5 |

---

## Knowledge Base Updates (knowledgeBases.js)

### CONDITION_CODES — Added
- `1505=Lung Cancer`, `1629=Mal neo bronch/lung NOS`, `496=Chr airway obstruct NEC (COPD)`, `49322=COPD exacerbation`, `4293=Cardiomegaly/LVH`, `27800=Obesity NOS`, `25050=DMII ophth`, `25002=DMII wo cmp uncntrld`

### DRUG_CODES — Added
- `HCTZ25, LOSA50, TIOTR18, ALBUT90, FLUT_SALM, CARBO150, PACLI100, PEMBRO100`

### LOINC_CODES — No changes needed (all LOINC codes already present)
### OBSERVATION_RANGES — No changes needed (all ranges already present)
### PROCEDURE_CODES — No changes needed (all CPT codes already present)

---

## Data Generation Script
- **File**: `generate_3patients.py` (not committed to git)
- **Library**: openpyxl
- **Sheets populated**: All 29 sheets
- **Total data created**: ~1,200+ rows across all sheets for 3 patients

---

## Vitals Per Patient (Vitals Sheet)

5 vitals × 5 key encounters = 25 rows per patient, 75 total new rows.

| Vital | LOINC | observation_code_id | All 3? |
|---|---|---|---|
| Systolic BP | 8480-6 | 754 | Yes |
| Diastolic BP | 8462-4 | 755 | Yes |
| Heart Rate | 8867-4 | 760 | Yes |
| Body Temperature | 8310-5 | 759 | Yes |
| SpO2 | 59408-5 | 763 | Yes |

---

## Lifestyle Goals Per Patient

34 daily entries (Apr 28 — May 31, 2026) per patient, 102 total new rows. Data characteristics:
- **P3 (HTN, 60F)**: Moderate activity — ~5,500 avg steps, 7 glasses water, 25 min exercise
- **P4 (DM+HTN, 55M)**: More active — ~6,000 avg steps, 8 glasses water, 30 min exercise
- **P5 (Cancer+COPD, 65M)**: Limited activity — ~3,000 avg steps, 6 glasses water, 10 min exercise

---

## Upcoming Appointments Per Patient

5 upcoming appointments each (June — October 2026), all `status: booked`.

---

## Care Gaps Summary

| Patient | Medication Non-Adherence | Missed Appointments |
|---|---|---|
| P3 | HCTZ self-discontinued (frequent urination) | Jan 2024, Jul 2025 |
| P4 | Metformin 1000mg self-discontinued (GI effects) | Jun 2024, May 2025 |
| P5 | Tiotropium self-discontinued (felt not helping) | Jul 2024, Nov 2025 |

---

## Data Generation Fixes (April 30, 2026)

### Date Format Fix
- **Problem**: All dates in the generated data were stored as plain text strings (`type=str`, `number_format=General`) instead of native Excel datetime objects like James Mitchell's data (`type=datetime`, `number_format=yyyy-mm-dd h:mm:ss`).
- **Fix**: Rewrote the generation script (`fix_dates_regen.py`) to use Python `datetime()` objects instead of date strings. Cleaned up all old string-based data first, then regenerated with proper datetime objects.
- All dates across all 29 sheets are now native Excel datetime objects.

### Column Alignment Fixes
- **organization** — Script wrote 15 columns (including address_line, postal_code, country, email) but the sheet only has 11 columns. Fixed to match: `id, active, name, type_code, type_display, phone, address_city, address_state, version, created_at, updated_at`.
- **patient_address** — Removed extra `type` column (`physical`). Changed state from "NC" abbreviation to "North Carolina" to match existing data. Sheet has 9 columns: `id, patient_id, use_type, line_1, line_2, city, state, postal_code, country`.
- **allergy_intolerance** — Added missing `code_system` column (`http://snomed.info/sct`). Removed extra reaction detail columns. Now matches 15-column format.
- **document_reference** — Removed extra `category_code`/`category_display` columns. Added missing `content_url`, `period_start`, `period_end` columns. Now matches 18-column format.

### Organization FK Fix
- **Problem**: Robert Anderson (P4) and Catherine Williams (Primary CM) referenced org UUID `a7b2c9d6-3e8f-0a1b-4c5d-6e7f8a9b0c1d` which didn't exist in the organization sheet.
- **Actual UUID**: `a7b2c9d6-3e8f-9a0b-4c1d-6f7a8b9c0d1e` (Raleigh Internal Medicine Associates, Row 3).
- **Fix**: Corrected the UUID in `patient` (1 row), `practitioner` (1 row), and `episode_of_care` (4 rows) — 6 total fixes.
- P4 reuses the existing Internal Medicine org (shared with James Mitchell / Dr. Brooks).

### Background Colour Verification
- Verified all 637 rows across 22 sheets have correct background colours.
- P3 = purple `#E8DAEF`, P4 = orange `#FDEBD0`, P5 = pink `#FADBD8`.
- All confirmed correct, zero fixes needed.

### chatbase_data_new.xlsx (Clean Copy)
- User duplicated `chatbase_data.xlsx` as `chatbase_data_new.xlsx`.
- Removed all 340 non-colored rows (James Mitchell's data already in the backend database).
- New file contains only: headers + P3/P4/P5 colored rows + master tables (for FK reference).
- Original `chatbase_data.xlsx` untouched.

### Fix Scripts Created (not committed to git)
- `fix_dates_regen.py` — Cleanup + regenerate with datetime objects
- `fix_columns.py` — Fix column alignment for patient_address, allergy_intolerance, document_reference

---

## Session: May 5, 2026

### Clinical Trends — Backend Issue (RESOLVED)
- **Problem**: Clinical Trends tab showed "No observation data available" for new patients (P3, P4, P5) even though chatbot care gaps showed observation data correctly.
- **Root cause**: Backend's `/baseR4/Observation/search` API returned 60 results for new patients but without the `code.coding` field (LOINC code + display name). The dashboard parser `parseAllObservationsForTrends` requires `r.code?.coding?.[0]?.code` and skips entries without it.
- **Fix**: Backend team populated the `code.coding` field for new patients' observations (same fix they did for James Mitchell earlier).
- **No frontend changes needed.**

---

## Session: May 27-28, 2026

### R Systems Logo Update
- **New white logo**: `Rsystems_Logo_White.png` — used on dark backgrounds (dashboard navbar, dashboard loading)
- **New purple logo**: `Rsystems_Logo_Purple.png` — used on light backgrounds (login screen topbar, home screen navbar). Black background removed and made transparent via Python PIL.
- **Old logo** (`LogoRsi.png`) no longer used.

| Screen | Logo | Background |
|---|---|---|
| Login screen topbar | Purple | Light |
| Home screen navbar | Purple | Light |
| Dashboard navbar | White | Dark |
| Dashboard loading | White | Dark |

- **Commits**: `d37aa7c`, `360f649`, `4268b90`, `7f16ed1`

### Chatbot Resize Handle
- Added drag-to-resize functionality to the chat panel via a corner grip handle (top-left).
- Drag to resize width and height. Min 320x300px, max fills screen.
- Works with mouse and touch.
- CSS: `.chat-resize-handle` with `cursor: nwse-resize`, positioned absolute top-left.
- **Commit**: `4cdc00d`

### Observation Trends — Action Chip
- Changed internal query from `"Plot Trends"` to `"Plot trends but I want you to ask me for which observation? Then after my response you plot the line graph"`.
- User clicks "Observation Trends" → chatbot asks which observation → user responds → chatbot plots that specific observation's line chart.
- Reverted the auto-plot-all and 1-year restriction approaches.
- **Commit**: `1357a6d`

### Chart Parser Fix (Brace-Depth)
- **Problem**: When multiple `[CHART:{...}]` blocks were in a response, the old regex (`[^[\]]*`) couldn't handle `[` and `]` inside JSON arrays (like `"labels":["date1","date2"]`). Raw JSON was shown to the user.
- **Fix**: Replaced regex with brace-depth counting parser. Correctly finds matching `}` for each `{` regardless of nested arrays.
- Also updated ChatWidget to render ALL chart blocks (not just the first one) via `allCharts` array.
- **Commit**: `be00b72`

### Patient ID Fix — Multiple Search Results
- **Problem**: When searching "James" returned 4 patients, the code stored `entries[0]` (James Evans) as current patient immediately — before the user chose one. The Launch CareCord AI button then pointed to the wrong patient.
- **Fix**: 
  1. Only set `currentPatientRef` when exactly 1 result returned
  2. When multiple results and LLM searches with both GIVEN + FAMILY, match by family name to find the correct patient
  3. When follow-up tools are called with a PATIENT UUID, capture that UUID as fallback
- **Commits**: `7fc3451`, `40082d3`

### Predefined Action Ref Bug — Clinical Summary After Care Gaps
- **Problem**: After clicking "View Care Gaps" (predefined action), typing "clinical summary" would silently send `"Show care gaps for patient {id}"` instead. The chatbot repeated care gaps instead of giving a clinical summary.
- **Root cause**: `handlePredefinedClick` set `pendingChipActionRef = 'caregaps'` but never cleared it — because it calls `agentLoop` directly, not `handleSend` (which clears the ref). So the next user-typed message was intercepted and replaced by the stale action.
- **Fix**: Predefined actions now build the query immediately and send it without using `pendingChipActionRef`. No leftover state after predefined actions complete.
- **Commit**: `314b8a9`
