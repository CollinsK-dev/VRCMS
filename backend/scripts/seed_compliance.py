"""Seed script to populate the compliance_standards collection with initial standards.

Usage: run from project root or backend directory with the app context available. Example:
    python -m backend.scripts.seed_compliance

This script assumes the app factory is available at backend.vrs_app.__init__.create_app
and that configuration contains MONGO_URI and MONGO_DBNAME.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + '/../')
from vrs_app import create_app
from vrs_app.services.db_service import mongo
from datetime import datetime

STANDARDS = [
    {
        'standard': 'OWASP Top 10',
        'control_id': 'A01:2021',
        'name': 'Broken Access Control',
        'description': 'Confirm resolution enforces least privilege and prevents unauthorized access (role checks, deny-by-default, object-level checks).',
        'relevance': 'Common high-impact web issue; must ensure proper authz checks.',
        'severity': 'High',
        'evidence_keywords': ['access control','authorization','role check','enforce role','deny-by-default','object-level','rbac','fix access'],
        
        'expected_evidence_type': 'code_fix'
    },
    {
        'standard': 'OWASP Top 10',
        'control_id': 'A03:2021',
        'name': 'Injection (SQL/Command/etc.)',
        'description': 'Verify input validation, parameterized queries, ORMs, and/or input sanitization used to eliminate injection.',
        'relevance': 'Injection can lead to data exfiltration or system takeover.',
        'severity': 'Critical',
        'evidence_keywords': ['parameterized','prepared statement','escape','sanitize','input validation','ORM','no direct concatenation'],
        
        'expected_evidence_type': 'code_fix'
    },
    {
        'standard': 'OWASP Top 10',
        'control_id': 'A05:2021',
        'name': 'Security Misconfiguration / Patching',
        'description': 'Confirm system or component hardening, disabling debug endpoints, removing unused services, and applied vendor patches.',
        'relevance': 'Misconfiguration is a frequent source of compromise.',
        'severity': 'High',
        'evidence_keywords': ['patched','update','disabled debug','hardened','closed port','updated package','disabled endpoint'],
        
        'expected_evidence_type': 'config_change'
    },
    {
        'standard': 'OWASP ASVS',
        'control_id': 'V5.1.2',
        'name': 'Cryptographic Best Practices',
        'description': 'Verify use of strong TLS, correct cipher suites, up-to-date libraries, and secure storage (bcrypt/argon2/scrypt for passwords).',
        'relevance': 'Protects confidentiality and integrity of data at rest/in transit.',
        'severity': 'High',
        'evidence_keywords': ['TLS 1.2','TLS 1.3','cipher','bcrypt','argon2','encrypt','encryption','keystore','secure storage'],
        
        'expected_evidence_type': 'config_change'
    },
    {
        'standard': 'NIST SP 800-53 / CIS',
        'control_id': 'AU-2 / CIS-8',
        'name': 'Logging and Audit Trails',
        'description': 'Verify logs capture who performed the change, when, and what was changed; confirm logs are retained and protected.',
        'relevance': 'Critical for incident investigations and proving remediation occurred.',
        'severity': 'Medium',
        'evidence_keywords': ['audit log','logged','log entry','retention','immutable logs','syslog','elk','splunk','logged by'],
        
        'expected_evidence_type': 'evidence'
    },
    {
        'standard': 'CIS / Vulnerability Management',
        'control_id': 'CIS-7',
        'name': 'Vulnerability Patching & Verification',
        'description': 'Confirm patch application, CVE referenced, and verification steps (tests or scan results).',
        'relevance': 'Avoid re-exposure by ensuring the patch fixes the identified CVE.',
        'severity': 'Critical',
        'evidence_keywords': ['CVE-','patched version','upgraded to','fixed in','verified with scan','retest','vuln scan'],
        
        'expected_evidence_type': 'patch'
    },
    {
        'standard': 'OWASP Top 10 / ASVS',
        'control_id': 'A01.1',
        'name': 'Input Validation and Output Encoding',
        'description': 'Confirm that inputs are validated server-side and outputs are encoded to prevent XSS or other injection vectors.',
        'relevance': 'Prevents cross-site scripting and similar vectors.',
        'severity': 'High',
        'evidence_keywords': ['validate input','server-side validation','encode output','html encode','escape output'],
        
        'expected_evidence_type': 'code_fix'
    },
    {
        'standard': 'NIST / ISO',
        'control_id': 'IA-2',
        'name': 'Authentication and Multi-Factor',
        'description': 'Confirm that accounts are protected by strong authentication and MFA where required, and that password storage is secure.',
        'relevance': 'Prevents account takeover and unauthorized access.',
        'severity': 'High',
        'evidence_keywords': ['mfa','two-factor','2fa','multifactor','password hashing','bcrypt','argon2','reset flow'],
        
        'expected_evidence_type': 'config_change'
    },
    {
        'standard': 'CIS / ISO 27001',
        'control_id': 'CM-2 / CIS-4',
        'name': 'Secure Configuration and Secrets Management',
        'description': 'Verify secrets moved to vault, credentials rotated, and configs removed from code repos.',
        'relevance': 'Reduces risk of secret leakage and misconfiguration.',
        'severity': 'High',
        'evidence_keywords': ['vault','secrets manager','rotated','rotated credentials','do not store secrets','env var removed'],
        
        'expected_evidence_type': 'config_change'
    },
    {
        'standard': 'NIST / ISO',
        'control_id': 'IR-1',
        'name': 'Incident Response and Post-mortem',
        'description': 'Confirm incident was recorded, root cause analysis performed, and lessons/actions documented.',
        'relevance': 'Ensures continuous improvement and prevents recurrence.',
        'severity': 'Medium',
        'evidence_keywords': ['post-mortem','root cause','RCA','incident recorded','lessons learned','action items'],
        
        'expected_evidence_type': 'evidence'
    },
    {
        'standard': 'GDPR / ISO / NIST',
        'control_id': 'PR-1',
        'name': 'Data Retention and Deletion',
        'description': 'Confirm any retained sensitive data was minimized and deletion/retention policies applied.',
        'relevance': 'Privacy and regulatory compliance.',
        'severity': 'Medium',
        'evidence_keywords': ['deleted data','retention','purged','anonymized','data retention policy'],
        
        'expected_evidence_type': 'evidence'
    },
    {
        'standard': 'CIS / Supply Chain',
        'control_id': 'SD-1',
        'name': 'Secure Dependencies / SBOM',
        'description': 'Confirm dependency upgrade or SBOM published and vulnerability-free versions in use.',
        'relevance': 'Supply-chain vulnerabilities can introduce critical risk.',
        'severity': 'High',
        'evidence_keywords': ['dependency updated','sbom','software bill','upgrade dependency','no vulnerable libraries'],
        
        'expected_evidence_type': 'patch'
    },
    {
        'standard': 'Operational / Email Security',
        'control_id': 'ES-1',
        'name': 'Email Ingest & Validation',
        'description': 'Confirm email processing validates sender, dedupes messages, and avoids re-ingest of resolved reports. Ensure mailboxes are configured securely.',
        'relevance': 'Prevents re-ingestion and unauthorized submissions.',
        'severity': 'Medium',
        'evidence_keywords': ['validated sender','dedupe','skip resolved','message-id','blacklist','imap','oauth2'],
        
        'expected_evidence_type': 'config_change'
    },
    {
        'standard': 'ISO 27001 / ITIL',
        'control_id': 'CM-3',
        'name': 'Change Management and Approvals',
        'description': 'Confirm configuration changes went through change control and approvals where necessary (ticket id, approver noted).',
        'relevance': 'Reduces unexpected outages and ensures accountability.',
        'severity': 'Medium',
        'evidence_keywords': ['change request','jira','ticket','approved by','approval','change id'],
        
        'expected_evidence_type': 'evidence'
    },
    {
        'standard': 'Auditability',
        'control_id': 'AUD-1',
        'name': 'Assignee Identity & Role Recorded',
        'description': "Confirm the resolution records include assignee full name and email and that the resolver role is recorded (e.g., 'superadmin' vs 'admin').",
        'relevance': 'Critical for traceability and audits.',
        'severity': 'Low',
        'evidence_keywords': ['assignee','assignee email','assignee name','resolved_by_role','resolved_by_email'],
        
        'expected_evidence_type': 'evidence'
    }
]


def seed():
    app = create_app()
    with app.app_context():
        mongo.init_app(app)
        db = mongo.db
        # Remove all existing standards and insert new ones
        db.compliance_standards.delete_many({})
        to_insert = []
        for s in STANDARDS:
            doc = s.copy()
            # Ensure evidence_keywords field is not included in inserted documents
            if 'evidence_keywords' in doc:
                doc.pop('evidence_keywords', None)
            doc['created_at'] = datetime.now()
            to_insert.append(doc)

        if to_insert:
            res = db.compliance_standards.insert_many(to_insert)
            db.compliance_standards.create_index('control_id')
            db.compliance_standards.create_index('name')
            print(f"Replaced with {len(res.inserted_ids)} new compliance standards.")
        else:
            print('No standards to insert.')


if __name__ == '__main__':
    seed()
