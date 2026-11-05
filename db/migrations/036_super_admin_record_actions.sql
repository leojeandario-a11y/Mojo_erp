CREATE TRIGGER trg_content_items_audit
AFTER INSERT OR UPDATE OR DELETE ON content_items
FOR EACH ROW EXECUTE FUNCTION audit_row('marketing');

CREATE TRIGGER trg_campaign_results_audit
AFTER INSERT OR UPDATE OR DELETE ON campaign_results
FOR EACH ROW EXECUTE FUNCTION audit_row('marketing');
