-- Create medication_reconciliations table (Plural to match implementation)
CREATE TABLE IF NOT EXISTS medication_reconciliations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_code VARCHAR(50) NOT NULL,
    site VARCHAR(100) NOT NULL, -- The reconciliation 'site' (e.g., Admission, Discharge)
    findings TEXT NOT NULL,      -- Clinical findings and decisions
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- Foreign Key to patients table using patient_code
    FOREIGN KEY (patient_code) REFERENCES patients(patient_code) ON DELETE CASCADE
);

-- Enable RLS
ALTER TABLE medication_reconciliations ENABLE ROW LEVEL SECURITY;

-- Select policy
CREATE POLICY medication_reconciliations_select ON medication_reconciliations
    FOR SELECT USING (true); -- Simplified for now, or match existing patient access logic

-- Insert policy
CREATE POLICY medication_reconciliations_insert ON medication_reconciliations
    FOR INSERT WITH CHECK (true);

-- Update policy
CREATE POLICY medication_reconciliations_update ON medication_reconciliations
    FOR UPDATE USING (true);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_medication_reconciliations_updated_at
    BEFORE UPDATE ON medication_reconciliations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
