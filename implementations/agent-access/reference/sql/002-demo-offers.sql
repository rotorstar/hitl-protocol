-- Persisted demonstration catalogue. These are explicitly not commercial offers.
INSERT INTO offers(id,title,unit_price_cents,fee_cents,refundable,terms,stock) VALUES
 ('refundable-100','Demonstration: refundable booking',10000,0,true,'Fully refundable. Demonstration only; no external provider.',100),
 ('review-10001','Demonstration: booking requiring review',10001,0,true,'Fully refundable. Demonstration only; no external provider.',100),
 ('nonrefundable-50','Demonstration: non-refundable booking',5000,0,false,'Non-refundable. Demonstration only; no external provider.',100),
 ('limit-500','Demonstration: maximum booking',50000,0,true,'Fully refundable. Demonstration only; no external provider.',100),
 ('over-limit','Demonstration: rejected booking',50001,0,true,'Fully refundable. Demonstration only; no external provider.',100),
 ('fees','Demonstration: quantity and fees',4000,2500,true,'Fee is per booking; total includes quantity and fee. Demonstration only.',100)
ON CONFLICT DO NOTHING;
