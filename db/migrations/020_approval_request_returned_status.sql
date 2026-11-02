ALTER TABLE approval_requests
  DROP CONSTRAINT approval_requests_status_check;

ALTER TABLE approval_requests
  ADD CONSTRAINT approval_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'returned'));
