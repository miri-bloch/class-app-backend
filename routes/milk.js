const express = require('express');
const router = express.Router();
const milkController = require('../controllers/milkController');

// שליפת רשימת התורנויות
router.get('/', milkController.getMilkDuties);

// הרשמה לתורנות החלב (הוספה לתור)
router.post('/join', milkController.joinMilkQueue);

// סימון התורנות כבוצעה, העברה אוטומטית לבת הבאה ושליחת מייל תזכורת מעוצב דרך Brevo
router.patch('/:id/toggle', milkController.toggleMilkDuty);

module.exports = router;