const express = require('express');
const router = express.Router();
// פעולות הבקר שמטפלות בבקשות תורנות החלב.
const milkController = require('../controllers/milkController');

// שליפת רשימת התורנויות
// מחזיר את תורנויות החלב.
router.get('/', milkController.getMilkDuties);

// הרשמה לתורנות החלב (הוספה לתור)
// מוסיף משתמשת לתורנות.
router.post('/join', milkController.joinMilkQueue);

// סימון התורנות כבוצעה, העברה אוטומטית לבת הבאה ושליחת מייל תזכורת מעוצב דרך Brevo
// מסמן תורנות שהושלמה.
router.patch('/:id/toggle', milkController.toggleMilkDuty);

module.exports = router;