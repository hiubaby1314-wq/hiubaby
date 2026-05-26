# 栗子素材网 (Lizi Materials)

A digital asset marketplace for anime-style character art, expressions, backgrounds, props, and effects.

## Features

- Role-based access control (user / vip / promo / admin)
- Material browsing with categories and search
- Preview lightbox with multi-image support
- Admin panel for user management and material CRUD
- Material request system
- Traditional/Simplified Chinese toggle
- Responsive design

## Project Structure

```
lizi-materials/
├── server.js           # Express backend with SQLite
├── package.json        # Node.js dependencies
├── public/
│   ├── index.html      # Main HTML
│   ├── css/
│   │   └── style.css   # Styles
│   ├── js/
│   │   └── app.js      # Frontend JavaScript
│   └── assets/         # Static assets (images, banner, etc.)
├── data/               # SQLite database (auto-created)
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 16+
- npm

### Installation

```bash
npm install
```

### Run

```bash
npm start
```

The server starts at `http://localhost:3000`.

## Default Admin Account

- Username: `admin`
- Password: `admin123`

### Creating User Accounts

After logging in as admin, use the admin panel to create new accounts:
- Default password for new accounts: `123456`
- Roles:
  - `user` - download expressions only
  - `vip` - download all materials
  - `promo` - limited-time offers + props
  - `admin` - full access + management

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/login` | User login |
| POST | `/api/changePwd` | Change password |
| GET | `/api/materials` | List all materials |
| POST | `/api/materials` | Add material (admin) |
| POST | `/api/materials/update` | Update material (admin) |
| POST | `/api/materials/delete` | Delete material (admin) |
| GET | `/api/admin/users` | List users (admin) |
| POST | `/api/admin/addUser` | Add user (admin) |
| POST | `/api/admin/delUser` | Delete user (admin) |
| POST | `/api/admin/toggleRole` | Toggle user role (admin) |
| POST | `/api/requests` | Submit material request |
| GET | `/api/requests` | List requests (admin) |
| POST | `/api/requests/read` | Mark requests as read (admin) |
| GET | `/api/requests/count` | Count unread requests (admin) |
| GET | `/api/me` | Get user info |
| POST | `/api/bind-accounts` | Save social bindings |

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Backend**: Node.js + Express
- **Database**: SQLite (better-sqlite3)
- **File Upload**: Multer

## License

MIT
