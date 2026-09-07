// מתעד את הבקשה ואת זמן הטיפול בה לאחר שהתגובה מסתיימת.
function requestLogger(req, res, next) {
  const startedAt = Date.now();

  // מאזין לסיום התגובה כדי להדפיס גם את סטטוס התשובה.
  res.on('finish', () => {
    const duration = Date.now() - startedAt;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });

  // מעביר את הבקשה ל-middleware או ל-route הבא.
  next();
}

module.exports = requestLogger;