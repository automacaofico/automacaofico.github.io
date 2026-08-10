ALTER TABLE activation_codes ADD COLUMN code_ciphertext TEXT;
ALTER TABLE activation_codes ADD COLUMN code_iv TEXT;

CREATE INDEX idx_activation_codes_status
  ON activation_codes(used_at, expires_at, created_at DESC);
