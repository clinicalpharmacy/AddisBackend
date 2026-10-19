import express from "express";
import jwt from "jsonwebtoken";
import { config } from "../config/env.js";
import { analyzePatientCDSS } from "../services/geminiService.js";

const router = express.Router();

const optionalAuth = (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (token) {
            req.user = jwt.verify(token, config.jwtSecret);
        }
    } catch (e) {
        // Proceed even if token is absent/invalid
    }
    next();
};

/**
 * Endpoint for AI-powered patient analysis (CDSS).
 * De-identifies patient data manually if necessary, or expects de-identified data from frontend.
 */
router.post("/cdss-analysis", optionalAuth, async (req, res) => {
    try {
        const {
            age,
            sex,
            pregnancy,
            conditions,
            labs,
            medications,
            vitals
        } = req.body;

        // De-identification (Ensure no patient names, identifiers are included)
        const patientData = {
            age,
            sex,
            pregnancy: pregnancy || false,
            conditions: conditions || [],
            labs: labs || {},
            medications: medications || [],
            vitals: vitals || {}
        };

        const analysis = await analyzePatientCDSS(patientData);

        res.json({
            success: true,
            analysis,
            disclaimer: "AI-generated - clinical pharmacist verification required. For advisory purposes only."
        });

    } catch (error) {
        console.error("CDSS Route Error [CRITICAL]:", {
            message: error.message,
            stack: error.stack,
            data: req.body
        });
        res.status(500).json({
            success: false,
            error: error.message || "Internal server error during AI analysis"
        });
    }
});

export default router;
