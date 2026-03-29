Foodbridge

Problem:

EcoTech:

FoodBridge: Real-Time Surplus Food Redistribution Platform
A significant amount of food waste occurs at the consumer level due to the absence of efficient
redistribution systems. Surplus food often goes unused because there is no real-time mechanism to
connect individuals or providers with those who need it. Additionally, limited awareness and poor
coordination further hinder timely redistribution.

This gap leads to increased food wastage, contributing to environmental damage and lost
opportunities to combat hunger. Without a reliable and trusted system to manage logistics, safety,
and accessibility, surplus food cannot be effectively utilized to support communities in need.

💡 Solution

FoodBridge is a real-time platform that connects people who have surplus food (donors) with those who need it (receivers) in a fast and efficient way.

Donors can easily create a food listing by providing details such as type of food, quantity, and expiry time. Nearby receivers can instantly view these listings and request the food based on their needs.

Once a request is made, the donor can accept it, and the system updates the status of the transaction until the food is successfully delivered and marked as completed.

The platform focuses on simplicity and speed, ensuring that food is redistributed before it expires. By enabling quick matching and reducing coordination delays, FoodBridge helps minimize food waste and ensures that surplus food reaches the right people at the right time.

Tech stack for this app (`FoodBridge`) is:

- Frontend: `Angular 21` (TypeScript), `RxJS`, `Zone.js`
- Build tooling: `Angular CLI`, `@angular/build`, `Vitest`, `Prettier`
- Backend: `Node.js` + `Express 5` (CommonJS)
- Database: `SQLite` (`sqlite` + `sqlite3`, file-based `foodbridge.db`)
- Auth/Security: `JWT` (`jsonwebtoken`), password hashing with `bcryptjs`, `cors`, `dotenv`
- Maps/Location: `Mapbox GL JS` (token from `window.__env.MAPBOX_ACCESS_TOKEN`)
- Package manager: `npm` (frontend pinned to `npm@11.11.1`)


Application flow (end-to-end) is:

1. User enters app and goes to `login` (or `register`).
2. On login, backend validates credentials and role rules:
- `donor` can only continue as donor.
- `receiver`/`delivery` can stay same role or upgrade to donor.
3. Backend returns JWT; frontend stores it and redirects to role dashboard.

4. Donor flow:
- Donor creates listing (`title`, `qty`, `foodType`, `lat/lng`).
- Listing starts with `available_qty = total_qty` and status `active`.
- Donor dashboard shows their listings, notifications, summary, ratings, milestone.

5. Receiver flow:
- Receiver sees nearby active listings (distance-based).
- Receiver requests exact quantity from a listing.
- Backend reserves stock atomically and updates listing status:
`active` -> `partially_reserved` -> `fully_reserved`.
- Receiver can cancel 1 item or all (before completion), which restores stock.
- After delivery, receiver can submit donor review (stars + comment).

6. Delivery flow:
- Delivery users see request queue.
- They can:
- manually take a request, or
- send random assignment (45s offer window).
- Assigned delivery marks request as delivered.

7. Completion + rewards:
- Request status becomes `delivered`.
- Donor and delivery user get points.
- Notifications are created for donor/receiver/delivery events.
- Monthly delivery leaderboard updates from delivered requests.

8. Live updates:
- Dashboards auto-refresh every ~4 seconds.
- Donor/receiver live location is pushed to backend.
- Mapbox map shows live donor-receiver distance tracking.

Base URL: `http://localhost:5001`

**Auth (`/api/auth`)**
- `POST /api/auth/register`  
Body: `displayName, email, password, role, homeLat, homeLng`
- `POST /api/auth/login`  
Body: `email, password, desiredRole`
- `POST /api/auth/forgot-password`  
Body: `email`
- `POST /api/auth/reset-password`  
Body: `token, newPassword`
- `GET /api/auth/me`  
Header: `Authorization: Bearer <jwt>`
- `POST /api/auth/location`  
Body: `userId, lat, lng`

**Listings (`/api/listing`)**
- `POST /api/listing/create`  
Body: `donorId, title, qty, foodType, lng, lat`
- `GET /api/listing`  
Returns active/partially reserved listings
- `GET /api/listing/nearby?lat=<>&lng=<>&foodType=<>`
- `GET /api/listing/donor/:donorId`

**Requests / Delivery / Reviews (`/api/request`)**
- `POST /api/request/create`  
Body: `listingId, receiverId, requestedQty`
- `POST /api/request/:requestId/cancel`  
Body: `cancelQty`
- `GET /api/request/delivery`
- `POST /api/request/:requestId/take`  
Body: `deliveryUserId`
- `POST /api/request/:requestId/random-assign`
- `POST /api/request/:requestId/complete`
- `POST /api/request/:requestId/review`  
Body: `receiverId, stars, comment`
- `GET /api/request/receiver/:receiverId`
- `GET /api/request/notifications/:userId`
- `GET /api/request/leaderboard/monthly`
- `GET /api/request/donor/:donorId/live-map`
- `GET /api/request/donor/:donorId/summary`

The app uses **SQLite** with a local file: `backend/foodbridge.db` (initialized in `backend/models/database.js`).

Main tables:

- `users`: account info, role (`donor|receiver|delivery`), points, live/home location
- `listings`: donor food posts, quantity tracking (`total_qty`, `available_qty`), status
- `requests`: receiver requests, delivery assignment, request lifecycle status
- `notifications`: user activity feed messages
- `reviews`: receiver rating/comment for donor per request
- `delivery_orders`: legacy/support table (not primary flow)

1. Install prerequisites:
- `Node.js 18+`
- `npm`

2. Start backend:
```bash
cd backend
npm install
npm start
```
Backend runs at `http://localhost:5001`.

3. Start frontend (new terminal):
```bash
cd frontend
npm install
npm start
```
Frontend runs at `http://localhost:4200`.

4. Map setup:
- Mapbox token is read from `frontend/public/env.js` (and `src/assets/env.js`) via `window.__env.MAPBOX_ACCESS_TOKEN`.
- Update that token if needed before running.

5. Notes:
- SQLite DB (`foodbridge.db`) is auto-created on backend startup.
- JWT secret defaults to `testsecret` unless you set `JWT_SECRET` in env.

👥 Team
- Sridharshan E (Team Leader)  
- Rahul Dharneesh M R


Great future scope for this app is:

1. Production-grade security
- Email/SMS-based OTP reset, refresh tokens, RBAC middleware, rate limiting, audit logs.

2. Smarter matching engine
- Route optimization, ETA prediction, traffic-aware assignment, priority scoring (urgency, distance, food type).

3. Real-time architecture
- Move from 4s polling to WebSockets for live orders, status, and map updates.

4. Payment and incentives
- Wallet/reimbursement for delivery volunteers, partner sponsorships, reward redemption marketplace.

5. Trust and quality layer
- Food safety checklists, donor verification badges, complaint/dispute system, moderation dashboard.

6. Enterprise and NGO integrations
- APIs for restaurants, hostels, events, NGOs, and municipal food waste programs.

7. Analytics and impact reporting
- CO2 saved, meals delivered, hotspot maps, monthly CSR reports, donor performance dashboards.

8. Scale and reliability upgrades
- Migrate SQLite to PostgreSQL, containerized deployment, CI/CD, monitoring, backups, and multi-city tenancy.
