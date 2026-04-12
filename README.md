# Photo Browser

A web application for managing and browsing local photo collections. Browse your photos in a beautiful thumbnail gallery, delete unwanted photos or folders, and view full-size images with zoom controls.

Disclaimer: Many features of this application were designed with the help of Cursor, an AI-assisted IDE.

## Features

- **Directory Browsing**: Navigate through your photo directory tree
- **Thumbnail Gallery**: View all images in a clean, responsive grid layout
- **Full-Size Viewer**: Open images in a modal with zoom in/out controls
- **Delete Management**: Remove individual photos or entire folders
- **Responsive Design**: Works on desktop and mobile browsers
- **Security**: Built-in path traversal protection

## Requirements

- Node.js (v14 or higher)
- npm or yarn

## Installation

1. Clone or download this project
2. Install dependencies:
   ```bash
   npm install
   ```

## Configuration

Set the `PHOTO_DIR` environment variable to specify where your photos are stored:

```bash
export PHOTO_DIR=/path/to/your/photos
npm start
```

If you don't set `PHOTO_DIR`, it defaults to your home directory (`HOME`).

## Running the Application

```bash
npm start
```

The application will be available at: **http://localhost:3000**

## Usage

1. Open http://localhost:3000 in your web browser
2. Navigate through folders by clicking on them
3. Click on any image thumbnail to view it in full size
4. Click the "Reveal" button to open the item in the local system manager
5. Click the "Delete" button to remove photos or folders
6. Use the breadcrumb navigation to go back up the directory tree

## Project Structure

```
photo-browser/
├── server.js              # Express server and API endpoints
├── package.json           # Project dependencies
├── public/                # Frontend files
│   ├── index.html         # Main HTML file
│   ├── styles.css         # Styling
│   └── app.js             # Frontend JavaScript
└── README.md              # This file
```

## API Endpoints

- `GET /api/files?dir=<path>` - Get folders and images in a directory
- `GET /api/image?path=<path>` - Get an image file
- `DELETE /api/file?path=<path>` - Delete a file
- `DELETE /api/directory?path=<path>` - Delete a directory and contents

## Security

The application includes path traversal protection to prevent accessing files outside the configured photo directory. All file paths are validated before access.

## Supported Image Formats

- `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`, `.svg`

## License

MIT
