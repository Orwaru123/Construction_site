CONSTRUCTION SITE ATTENDANCE - SITE FILTER UPDATE

Features:
- Worker registration with construction site (site can be selected or typed).
- Suggested sites: Kianda, Kiambu, Embu, Samburu, Homa Bay.
- Admin Dashboard filters attendance and registered workers by site and date.
- Check-in/check-out rules are retained.
- Data continues to be stored in attendance-data.json. No SQLite required.

IMPORTANT DATA PRESERVATION:
Before replacing files in an existing project, make a backup of attendance-data.json, workers.json, server.js and the public folder.
Do not delete attendance-data.json; existing workers and attendance should remain. Old records without a site are shown as Unassigned.

Termux:
1. Extract this ZIP into a new folder, or copy server.js, package.json and the public folder into the existing project after backing it up.
2. Keep your existing attendance-data.json in the same folder as server.js.
3. In Termux: npm install
4. Start: node server.js
5. Open Chrome: http://localhost:3000/
6. Use Register Worker to assign a site; use Admin Dashboard to filter.

Worker IDs must be 8 digits, phone numbers 10 digits beginning 01 or 07, and PIN 4-6 digits.
