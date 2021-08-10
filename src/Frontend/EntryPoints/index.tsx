import * as React from 'react';
import * as ReactDOM from 'react-dom';
import App from '../Pages/App';
import '../Styles/font/stylesheet.css';
import '../Styles/icomoon/style.css';
import '../Styles/preflight.css';
import '../Styles/style.css';

// source: https://developer.mozilla.org/en-US/docs/Web/API/WindowEventHandlers/onbeforeunload
window.addEventListener('beforeunload', (e) => {
  // Cancel the event
  e.preventDefault();
  // Chrome requires returnValue to be set
  e.returnValue = '';
});

ReactDOM.render(<App />, document.getElementById('root'));
