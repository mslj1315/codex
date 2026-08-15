ALTER TABLE accounts
  ADD COLUMN password_change_required BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX accounts_customer_mobile_login_idx
  ON accounts (login_name)
  WHERE password_change_required = true;
