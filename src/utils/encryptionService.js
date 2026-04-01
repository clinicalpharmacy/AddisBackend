import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const ITERATIONS = 10000;

/**
 * Service to handle client-side style encryption in the application.
 * Note: Key derivation should ideally happen on the client to ensure zero-knowledge,
 * but this service provides the backend primitives for a secure implementation.
 */
export const EncryptionService = {
    /**
     * Derive a cryptographic key from a password.
     * @param {string} password - The user's password.
     * @param {string} salt - A unique salt for the user.
     * @returns {string} - Hex encoded derived key.
     */
    deriveKeyFromPassword(password, salt) {
        if (!password || !salt) throw new Error('Password and salt are required');
        const bufferSalt = Buffer.isBuffer(salt) ? salt : Buffer.from(salt, 'hex');
        return crypto.pbkdf2Sync(password, bufferSalt, ITERATIONS, KEY_LENGTH, 'sha256').toString('hex');
    },

    /**
     * Generate a new random salt.
     * @returns {string} - Hex encoded salt.
     */
    generateSalt() {
        return crypto.randomBytes(SALT_LENGTH).toString('hex');
    },

    /**
     * Generate a random data encryption key (DEK).
     * @returns {string} - Hex encoded key.
     */
    generateDataKey() {
        return crypto.randomBytes(KEY_LENGTH).toString('hex');
    },

    /**
     * Encrypt data using a key.
     * @param {string} data - The plain text data.
     * @param {string} keyHex - Hex encoded symmetric key.
     * @returns {string} - Encrypted string in format 'iv:authTag:cipher' (all hex).
     */
    encrypt(data, keyHex) {
        if (!data) return null;
        if (!keyHex) throw new Error('Encryption key is required');

        const key = Buffer.from(keyHex, 'hex');
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        const authTag = cipher.getAuthTag().toString('hex');

        return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    },

    /**
     * Decrypt data using a key.
     * @param {string} encryptedData - Encrypted format 'iv:authTag:cipher'.
     * @param {string} keyHex - Hex encoded symmetric key.
     * @returns {string} - Decrypted plain text.
     */
    decrypt(encryptedData, keyHex) {
        if (!encryptedData) return null;
        if (!keyHex) throw new Error('Decryption key is required');

        try {
            const [ivHex, authTagHex, cipherText] = encryptedData.split(':');
            if (!ivHex || !authTagHex || !cipherText) return encryptedData; // Assume not encrypted or wrong format

            const key = Buffer.from(keyHex, 'hex');
            const iv = Buffer.from(ivHex, 'hex');
            const authTag = Buffer.from(authTagHex, 'hex');

            const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
            decipher.setAuthTag(authTag);

            let decrypted = decipher.update(cipherText, 'hex', 'utf8');
            decrypted += decipher.final('utf8');

            return decrypted;
        } catch (error) {
            console.error('Decryption failed:', error.message);
            // Return original data or throw based on preference. 
            // Here we return original to handle partially migrated databases gracefully.
            return encryptedData; 
        }
    }
};
