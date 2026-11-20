-- A resident's maximum price (c/kWh incl. VAT) for one request: the car never charges in a
-- slot that costs more (rule koivurinne-fair-share/2). Optional; NULL means no limit. It is
-- part of the sealed request and its commitment.
ALTER TABLE requests ADD COLUMN max_price_cents REAL;
