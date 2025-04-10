# Context Dictionary Chrome Extension

A context-aware smart dictionary Chrome extension that helps users understand word meanings in web pages and provides related learning resources.

## Features

- Select any word to get its definition
- Context-aware intelligent explanations
- Provides related learning resources
- Clean and beautiful popup interface
- Right-click menu for quick lookup

## Installation

1. Open Chrome browser and go to extensions page (chrome://extensions/)
2. Enable "Developer mode" at top right
3. Click "Load unpacked"
4. Select this project folder

## Usage

1. Select any word on a webpage
2. Definition and related resources will show automatically
3. Or right-click selected text and choose "Get definition"

## Configuration

Before using, you need to configure in `background.js` file:

1. API_ENDPOINT: Set to your AI service endpoint
2. API_KEY: Set to your API key

## Technology Stack

- Chrome Extension Manifest V3
- JavaScript
- HTML/CSS

## Notes

- Make sure you have a valid AI service API and corresponding key
- Recommended to limit API call frequency to control cost
- Keep your API key secure
