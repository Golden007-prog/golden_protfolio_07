"""Dump own LinkedIn profile to src/data/profile.json."""
import json, os
from pathlib import Path
from dotenv import load_dotenv
from linkedin_api import Linkedin

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / "linkedin-mcp" / ".env")

client = Linkedin(os.environ["LINKEDIN_EMAIL"], os.environ["LINKEDIN_PASSWORD"])
pid = os.environ["LINKEDIN_PUBLIC_ID"]

profile = client.get_profile(pid)
skills = client.get_profile_skills(pid)
contact = client.get_profile_contact_info(pid)

out = {
    "name": f"{profile.get('firstName','')} {profile.get('lastName','')}".strip(),
    "headline": profile.get("headline", ""),
    "about": profile.get("summary", ""),
    "location": profile.get("locationName", ""),
    "industry": profile.get("industryName", ""),
    "experience": [
        {
            "company": e.get("companyName", ""),
            "role": e.get("title", ""),
            "duration": f"{e.get('timePeriod',{}).get('startDate',{}).get('year','')}-{e.get('timePeriod',{}).get('endDate',{}).get('year','Present')}",
            "description": e.get("description", ""),
            "location": e.get("locationName", ""),
        }
        for e in profile.get("experience", [])
    ],
    "education": [
        {
            "institution": ed.get("schoolName", ""),
            "degree": ed.get("degreeName", ""),
            "field": ed.get("fieldOfStudy", ""),
            "year": f"{ed.get('timePeriod',{}).get('startDate',{}).get('year','')}-{ed.get('timePeriod',{}).get('endDate',{}).get('year','')}",
        }
        for ed in profile.get("education", [])
    ],
    "skills": [s.get("name", "") for s in skills],
    "certifications": [c.get("name", "") for c in profile.get("certifications", [])],
    "contact": contact,
}

data_dir = ROOT / "src" / "data"
data_dir.mkdir(parents=True, exist_ok=True)
(data_dir / "profile.json").write_text(json.dumps(out, indent=2, ensure_ascii=False))
print(f"Wrote {data_dir / 'profile.json'}: {len(out['experience'])} exp, {len(out['skills'])} skills")
