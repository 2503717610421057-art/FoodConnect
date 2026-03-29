const jwt = require("jsonwebtoken");

// 1. STANDARD AUTH: Verifies who the user is
const verifyToken = (req, res, next) => {
  const authHeader = req.header("Authorization");
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ msg: "Access denied. Invalid or missing token." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Attaches { id, role } to the request
    next();
  } catch (error) {
    res.status(401).json({ msg: "Invalid or expired token." });
  }
};

// 2. ROLE-BASED ACCESS CONTROL (RBAC): Verifies what the user can do
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    // req.user is set by verifyToken. If it doesn't exist, they aren't logged in.
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        msg: `Access forbidden: Requires one of the following roles: ${allowedRoles.join(", ")}` 
      });
    }
    next();
  };
};

// Export both functions so you can use them in your routes
module.exports = { verifyToken, authorizeRoles };