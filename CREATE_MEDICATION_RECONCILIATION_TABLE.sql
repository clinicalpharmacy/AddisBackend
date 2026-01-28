-- ============================================
-- MEDICATION RECONCILIATION TABLE CREATION
-- ============================================
-- This table stores medication reconciliation data for patients
-- Medication reconciliation is the process of comparing a patient's 
-- medication orders to all medications the patient has been taking

-- Create medication_reconciliation table
CREATE TABLE IF NOT EXISTS medication_reconciliation (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_code VARCHAR(50) NOT NULL,
    
    -- Reconciliation Information
    reconciliation_date TIMESTAMP NOT NULL DEFAULT NOW(),
    reconciliation_type VARCHAR(50) NOT NULL, -- 'Admission', 'Transfer', 'Discharge', 'Routine'
    performed_by VARCHAR(255), -- Name of person who performed reconciliation
    performed_by_role VARCHAR(100), -- 'Pharmacist', 'Nurse', 'Doctor', etc.
    
    -- Medication Details
    medication_name VARCHAR(255) NOT NULL,
    dose VARCHAR(100),
    route VARCHAR(50), -- 'PO', 'IV', 'IM', etc.
    frequency VARCHAR(100),
    indication VARCHAR(500),
    
    -- Reconciliation Status
    reconciliation_status VARCHAR(50) NOT NULL DEFAULT 'Pending', -- 'Pending', 'Verified', 'Discrepancy Found', 'Resolved'
    action_taken VARCHAR(50), -- 'Continue', 'Discontinue', 'Modify', 'Add', 'Hold'
    
    -- Discrepancy Information
    discrepancy_type VARCHAR(100), -- 'Omission', 'Commission', 'Dose Error', 'Frequency Error', etc.
    discrepancy_details TEXT,
    resolution_notes TEXT,
    
    -- Source Information
    source VARCHAR(100), -- 'Patient Interview', 'Previous Records', 'Family', 'Pharmacy', etc.
    home_medication BOOLEAN DEFAULT false, -- Is this a home medication?
    hospital_medication BOOLEAN DEFAULT false, -- Is this a hospital medication?
    
    -- Additional Information
    prescriber_name VARCHAR(255),
    pharmacy_name VARCHAR(255),
    last_fill_date DATE,
    notes TEXT,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Foreign Keys
    FOREIGN KEY (patient_code) REFERENCES patients(patient_code) ON DELETE CASCADE
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_med_recon_patient_code ON medication_reconciliation(patient_code);
CREATE INDEX IF NOT EXISTS idx_med_recon_date ON medication_reconciliation(reconciliation_date DESC);
CREATE INDEX IF NOT EXISTS idx_med_recon_status ON medication_reconciliation(reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_med_recon_type ON medication_reconciliation(reconciliation_type);

-- Add RLS (Row Level Security) policies
ALTER TABLE medication_reconciliation ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own patients' reconciliations
CREATE POLICY medication_reconciliation_select_policy ON medication_reconciliation
    FOR SELECT
    USING (
        patient_code IN (
            SELECT patient_code FROM patients WHERE user_id = auth.uid()
        )
    );

-- Policy: Users can insert reconciliations for their own patients
CREATE POLICY medication_reconciliation_insert_policy ON medication_reconciliation
    FOR INSERT
    WITH CHECK (
        patient_code IN (
            SELECT patient_code FROM patients WHERE user_id = auth.uid()
        )
    );

-- Policy: Users can update their own patients' reconciliations
CREATE POLICY medication_reconciliation_update_policy ON medication_reconciliation
    FOR UPDATE
    USING (
        patient_code IN (
            SELECT patient_code FROM patients WHERE user_id = auth.uid()
        )
    );

-- Policy: Users can delete their own patients' reconciliations
CREATE POLICY medication_reconciliation_delete_policy ON medication_reconciliation
    FOR DELETE
    USING (
        patient_code IN (
            SELECT patient_code FROM patients WHERE user_id = auth.uid()
        )
    );

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_medication_reconciliation_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER medication_reconciliation_updated_at_trigger
    BEFORE UPDATE ON medication_reconciliation
    FOR EACH ROW
    EXECUTE FUNCTION update_medication_reconciliation_updated_at();

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Verify table was created
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'medication_reconciliation'
ORDER BY ordinal_position;

-- Verify indexes
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'medication_reconciliation';

-- Verify RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename = 'medication_reconciliation';

COMMENT ON TABLE medication_reconciliation IS 'Stores medication reconciliation data for patients to ensure medication safety during transitions of care';
COMMENT ON COLUMN medication_reconciliation.reconciliation_type IS 'Type of reconciliation: Admission, Transfer, Discharge, or Routine';
COMMENT ON COLUMN medication_reconciliation.action_taken IS 'Action taken during reconciliation: Continue, Discontinue, Modify, Add, or Hold';
COMMENT ON COLUMN medication_reconciliation.discrepancy_type IS 'Type of discrepancy found: Omission, Commission, Dose Error, Frequency Error, etc.';
