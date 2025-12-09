# Codem User Profiles & Data Persistence

## Overview

Codem now includes a complete user authentication system with persistent data storage! Users can now:
- Register and login with secure authentication
- Save activities to their profile
- Track their submission history
- View detailed statistics and progress
- Access all their data from a personalized profile page

## What's New

### Database Integration
- **SQLite database** for persistent storage (located at `Codem-backend/data/codem.db`)
- Three main tables: `users`, `activities`, and `submissions`
- Automatic schema initialization on first run

### Authentication System
- **JWT-based authentication** with secure password hashing (bcrypt)
- Token expires in 7 days (configurable)
- Protected routes require authentication

### 📊 User Statistics
The profile page displays:
- Total submissions count
- Success rate percentage
- Number of activities attempted
- Number of problems solved
- Average execution time

### 💾 Data Saved Automatically
Everything is now persisted:
- User accounts and profiles
- All created activities (linked to the user who created them)
- Every code submission with results
- Timestamps for all actions

## Backend Changes

### New Files Created

1. **`src/database.ts`**
   - Database schema and initialization
   - CRUD operations for users, activities, and submissions
   - Statistics queries

2. **`src/auth.ts`**
   - Password hashing and verification
   - JWT token generation and verification
   - Authentication middleware

### New API Endpoints

#### Authentication
- `POST /auth/register` - Create a new user account
  ```json
  {
    "username": "johndoe",
    "email": "john@example.com",
    "password": "securepassword",
    "displayName": "John Doe" // optional
  }
  ```

- `POST /auth/login` - Login with username/email and password
  ```json
  {
    "username": "johndoe", // or email
    "password": "securepassword"
  }
  ```

- `GET /auth/me` - Get current user info (requires auth token)

#### Profile
- `GET /profile` - Get complete profile with stats, activities, and submissions (requires auth)

#### Activities (Updated)
- `POST /activities` - Now requires authentication and saves to user's profile
- `GET /activities` - Get all activities for the authenticated user
- `GET /activities/:id` - Get specific activity (public, no auth required)

#### Submissions (Updated)
- `POST /submit` - Now tracks submissions in database if user is authenticated

### Environment Variables

Add to your `.env` file:
```env
JWT_SECRET=your-secret-key-change-in-production
```

## Frontend Changes

### New Pages

1. **`/auth/login`** - Login page
   - Clean, modern design
   - Username or email login
   - Link to registration

2. **`/auth/register`** - Registration page
   - Complete signup form
   - Password confirmation
   - Optional display name

3. **`/profile`** - User profile page
   - Stats dashboard with 4 key metrics
   - Activities list with links
   - Recent submissions history
   - Account information
   - Logout button

### Updated Pages

1. **Home Page** (`/`)
   - Shows login button or username when logged in
   - Redirects to login if trying to generate activity without auth
   - Sends auth token with activity creation requests

2. **Activity Page** (`/activity/[id]`)
   - Sends auth token with submissions (if logged in)
   - Tracks submissions in database automatically
   - Added "Home" button for easier navigation

## How to Use

### 1. Setup Backend

```bash
cd Codem-backend

# Install new dependencies (already done if you ran the commands)
npm install better-sqlite3 @types/better-sqlite3 bcryptjs @types/bcryptjs jsonwebtoken @types/jsonwebtoken

# Add JWT_SECRET to your .env file
echo "JWT_SECRET=your-secret-key-here" >> .env

# Build
npm run build

# Start the server
npm start
```

The database will be automatically created at `Codem-backend/data/codem.db` on first run.

### 2. Setup Frontend

```bash
cd Codem-frontend/codem-frontend

# No new dependencies needed!
# Just start the dev server
npm run dev
```

### 3. Using the System

1. **Register a new account**
   - Go to `http://localhost:3000`
   - Click "Login" in the header
   - Click "Sign up" link
   - Fill in the registration form

2. **Create activities**
   - After logging in, use the chat interface to describe your desired activity
   - Click "Generate Activity"
   - The activity is automatically saved to your profile

3. **View your profile**
   - Click your username in the header
   - See your stats, activities, and submission history

4. **Solve problems**
   - Click on any activity to start solving
   - Your submissions are automatically tracked
   - Stats update in real-time

## Database Schema

### Users Table
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

### Activities Table
```sql
CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT,
  problems TEXT NOT NULL, -- JSON string
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
)
```

### Submissions Table
```sql
CREATE TABLE submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  activity_id TEXT NOT NULL,
  problem_id TEXT NOT NULL,
  code TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  passed_tests INTEGER NOT NULL,
  total_tests INTEGER NOT NULL,
  execution_time_ms INTEGER,
  submitted_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (activity_id) REFERENCES activities(id)
)
```

## Security Features

- ✅ Passwords hashed with bcrypt (10 rounds)
- ✅ JWT tokens for stateless authentication
- ✅ Protected API routes require valid tokens
- ✅ Token expiration (7 days by default)
- ✅ Foreign key constraints for data integrity
- ✅ SQL injection prevention (parameterized queries)

## Future Enhancements

Potential improvements:
- [ ] Password reset functionality
- [ ] Email verification
- [ ] Social login (Google, GitHub)
- [ ] Activity sharing between users
- [ ] Leaderboards and achievements
- [ ] Export code submissions
- [ ] Activity templates
- [ ] Collaborative problem solving
- [ ] Teacher/student roles

## Migration from In-Memory Storage

If you had activities stored in memory before:
- Old activities are NOT automatically migrated
- Users need to create new accounts
- Activities must be regenerated after logging in
- The database starts fresh

To preserve old data, you would need to write a migration script to convert the in-memory Map data to database records.

## Troubleshooting

### Database locked error
If you see "database is locked", make sure only one backend instance is running.

### Token expired
Tokens expire after 7 days. Users need to log in again.

### Cannot find module 'better-sqlite3'
Run `npm install` in the backend directory again.

### CORS errors
Make sure your backend is running on port 4000 and frontend on port 3000 (or update BACKEND_URL accordingly).

## Tech Stack

### Backend
- Express.js
- better-sqlite3 (SQLite database)
- bcryptjs (password hashing)
- jsonwebtoken (JWT authentication)
- TypeScript

### Frontend
- Next.js 15 (App Router)
- React 19
- Tailwind CSS
- TypeScript

---

**Enjoy your new persistent Codem experience!** 🎉

All user data is now safely stored and survives server restarts.
