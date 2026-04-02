import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://xrruljrhjftcfxllaesa.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhycnVsanJoamZ0Y2Z4bGxhZXNhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTY3MzM5MiwiZXhwIjoyMDc3MjQ5MzkyfQ.-GSqt5LlY8vECS8kKRzOpEjxTyZN3Vo7FspO6KGJDK4';

const supabase = createClient(supabaseUrl, supabaseKey);

const SENSITIVE_FIELDS = [
    'full_name', 'age', 'age_in_days', 'date_of_birth', 'gender', 'contact_number', 'address', 
    'patient_type', 'diagnosis', 'allergies', 'appointment_date', 'is_active', 'is_pregnant', 
    'pregnancy_weeks', 'pregnancy_trimester', 'pregnancy_notes', 'edd', 'birth_weight', 
    'birth_length', 'feeding_method', 'vaccination_status', 'developmental_milestones', 
    'special_instructions', 'blood_pressure', 'heart_rate', 'temperature', 'respiratory_rate', 
    'oxygen_saturation', 'weight', 'height', 'bmi', 'last_measured', 'hemoglobin', 'hematocrit', 
    'rbc', 'mcv', 'mch', 'mchc', 'rdw', 'platelets', 'wbc', 'neutrophils', 'lymphocytes', 
    'monocytes', 'eosinophils', 'basophils', 'sodium', 'potassium', 'chloride', 'bicarbonate', 
    'anion_gap', 'alt', 'ast', 'alkaline_phosphatase', 'total_bilirubin', 'direct_bilirubin', 
    'indirect_bilirubin', 'total_protein', 'albumin', 'globulin', 'ag_ratio', 'ggt', 'creatinine', 
    'blood_urea_nitrogen', 'bun_creatinine_ratio', 'egfr', 'troponin_i', 'troponin_t', 'ck_mb', 
    'nt_pro_bnp', 'myoglobin', 'tsh', 'free_t3', 'free_t4', 'crp', 'esr', 'ferritin', 
    'procalcitonin', 'pt', 'inr', 'aptt', 'd_dimer', 'fibrinogen', 'urine_color', 
    'urine_appearance', 'urine_ph', 'urine_specific_gravity', 'urine_protein', 'urine_glucose', 
    'urine_ketones', 'urine_blood', 'urine_leucocytes', 'urine_nitrites', 'urine_bilirubin', 
    'urine_urobilinogen', 'urine_rbc', 'urine_wbc', 'urine_epithelial_cells', 'urine_casts', 
    'urine_crystals', 'urine_bacteria', 'fasting_glucose', 'postprandial_glucose', 
    'random_glucose', 'insulin', 'c_peptide', 'hba1c', 'total_cholesterol', 'hdl_cholesterol', 
    'ldl_cholesterol', 'triglycerides', 'vldl_cholesterol', 'last_tested', 'alp', 
    'bilirubin_direct', 'wbc_count', 'rbc_count', 'platelet_count', 'blood_sugar', 'urea', 
    'uric_acid', 'calcium', 'magnesium', 'phosphate', 'bilirubin_total', 'bilirubin_indirect', 
    'troponin', 'ldh', 'total_t4', 'total_t3', 'ptt', 'bun', 'bilirubin_neonatal', 
    'glucose_neonatal', 'calcium_neonatal', 'pku_result', 'thyroid_screening', 
    'urine_leukocytes', 'urine_nitrite', 'weight_percentile', 'height_percentile', 
    'head_circumference_percentile', 'bmi_percentile', 'labs', 'is_lactating', 'lactation_notes'
];

async function generateMigration() {
    console.log('-- Migration to convert all patient fields to TEXT for encryption support');
    SENSITIVE_FIELDS.forEach(field => {
        // We use ALTER COLUMN TYPE TEXT. Note: if there is data, we might need a USING clause
        console.log(`ALTER TABLE patients ALTER COLUMN ${field} TYPE TEXT USING ${field}::TEXT;`);
    });
}

generateMigration();
