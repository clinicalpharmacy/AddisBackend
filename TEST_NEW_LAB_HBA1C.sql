-- ============================================
-- TEST CASE 3: HbA1c with Multiple Rules
-- ============================================
-- This tests a common lab with diabetes-related rules

-- Step 1: Ensure HbA1c lab exists (it might already exist)
INSERT INTO lab_tests (name, unit, reference_range, category, is_active, description)
VALUES (
    'HbA1c',
    '%',
    '4.0-5.6',
    'Diabetes Markers',
    true,
    'Hemoglobin A1c - Average blood glucose over past 2-3 months'
)
ON CONFLICT (name) DO UPDATE 
SET 
    unit = EXCLUDED.unit,
    reference_range = EXCLUDED.reference_range,
    category = EXCLUDED.category,
    is_active = EXCLUDED.is_active,
    description = EXCLUDED.description;

-- Step 2: Create rule for Prediabetes
INSERT INTO clinical_rules (
    rule_name,
    rule_type,
    rule_description,
    rule_condition,
    rule_action,
    severity,
    dtp_category,
    is_active,
    applies_to,
    created_at,
    updated_at
) VALUES (
    'Prediabetes HbA1c Alert',
    'lab_monitoring',
    'Alert when HbA1c indicates prediabetes (5.7-6.4%)',
    '{
        "all": [
            {
                "fact": "labs.hba1c",
                "operator": ">=",
                "value": 5.7
            },
            {
                "fact": "labs.hba1c",
                "operator": "<",
                "value": 6.5
            }
        ]
    }'::jsonb,
    '{
        "message": "Prediabetes Range Detected - HbA1c {{labs.hba1c}}%",
        "recommendation": "HbA1c is in the prediabetes range (5.7-6.4%). Recommend lifestyle modifications: weight loss if overweight, regular exercise, dietary changes. Consider metformin if high risk. Recheck HbA1c in 3-6 months.",
        "severity": "moderate"
    }'::jsonb,
    'moderate',
    'monitoring_needed',
    true,
    ARRAY['all_patients'],
    NOW(),
    NOW()
)
ON CONFLICT (rule_name) DO UPDATE 
SET 
    rule_condition = EXCLUDED.rule_condition,
    rule_action = EXCLUDED.rule_action,
    updated_at = NOW();

-- Step 3: Create rule for Diabetes
INSERT INTO clinical_rules (
    rule_name,
    rule_type,
    rule_description,
    rule_condition,
    rule_action,
    severity,
    dtp_category,
    is_active,
    applies_to,
    created_at,
    updated_at
) VALUES (
    'Diabetes HbA1c Alert',
    'lab_monitoring',
    'Alert when HbA1c indicates diabetes (≥6.5%)',
    '{
        "all": [
            {
                "fact": "labs.hba1c",
                "operator": ">=",
                "value": 6.5
            }
        ]
    }'::jsonb,
    '{
        "message": "Diabetes Range Detected - HbA1c {{labs.hba1c}}%",
        "recommendation": "HbA1c ≥6.5% indicates diabetes. Initiate or adjust diabetes management. Consider metformin as first-line therapy. Educate on diet, exercise, and glucose monitoring. Screen for complications. Target HbA1c <7% for most patients.",
        "severity": "high"
    }'::jsonb,
    'high',
    'monitoring_needed',
    true,
    ARRAY['all_patients'],
    NOW(),
    NOW()
)
ON CONFLICT (rule_name) DO UPDATE 
SET 
    rule_condition = EXCLUDED.rule_condition,
    rule_action = EXCLUDED.rule_action,
    updated_at = NOW();

-- Step 4: Create rule for Poorly Controlled Diabetes
INSERT INTO clinical_rules (
    rule_name,
    rule_type,
    rule_description,
    rule_condition,
    rule_action,
    severity,
    dtp_category,
    is_active,
    applies_to,
    created_at,
    updated_at
) VALUES (
    'Poorly Controlled Diabetes Alert',
    'lab_monitoring',
    'Alert when HbA1c indicates poorly controlled diabetes (≥9%)',
    '{
        "all": [
            {
                "fact": "labs.hba1c",
                "operator": ">=",
                "value": 9.0
            }
        ]
    }'::jsonb,
    '{
        "message": "CRITICAL: Poorly Controlled Diabetes - HbA1c {{labs.hba1c}}%",
        "recommendation": "HbA1c ≥9% indicates severely uncontrolled diabetes. URGENT: Intensify therapy immediately. Consider combination therapy or insulin. Assess adherence barriers. Screen for acute complications (DKA, HHS). Refer to endocrinology if needed.",
        "severity": "critical"
    }'::jsonb,
    'critical',
    'monitoring_needed',
    true,
    ARRAY['all_patients'],
    NOW(),
    NOW()
)
ON CONFLICT (rule_name) DO UPDATE 
SET 
    rule_condition = EXCLUDED.rule_condition,
    rule_action = EXCLUDED.rule_action,
    updated_at = NOW();

-- Verify
SELECT name, unit, reference_range FROM lab_tests WHERE name = 'HbA1c';
SELECT rule_name, severity FROM clinical_rules WHERE rule_name LIKE '%HbA1c%' OR rule_name LIKE '%Diabetes%' ORDER BY severity DESC;

-- ============================================
-- TEST INSTRUCTIONS:
-- ============================================
-- Test different HbA1c values to see different alerts:
-- 
-- 1. Enter 5.5 → NO ALERT (normal)
-- 2. Enter 6.0 → MODERATE ALERT (Prediabetes)
-- 3. Enter 7.5 → HIGH ALERT (Diabetes)
-- 4. Enter 9.5 → CRITICAL ALERT (Poorly Controlled)
--
-- Note: Multiple rules can trigger! If HbA1c = 9.5:
-- - "Diabetes HbA1c Alert" will trigger (≥6.5)
-- - "Poorly Controlled Diabetes Alert" will trigger (≥9.0)
-- You should see BOTH alerts!
-- ============================================
