require("dotenv").config();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const express = require("express");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Resend } = require("resend");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
// Sans clé Resend, les emails sont simplement désactivés (le serveur démarre quand même)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Envoie un email a la personne assignee, sans jamais faire planter la route
// si Resend echoue (ex: adresse non autorisee en plan gratuit)
async function sendTaskAssignedEmail(toEmail, taskTitle, projectName) {
  if (!resend) return;
  try {
    await resend.emails.send({
      from: "TaskFlow <onboarding@resend.dev>",
      to: toEmail,
      subject: `Nouvelle tâche assignée : ${taskTitle}`,
      html: `<p>Bonjour,</p><p>On vous a assigné la tâche <strong>${taskTitle}</strong> dans le projet <strong>${projectName}</strong>.</p>`,
    });
  } catch (err) {
    console.error("Echec envoi email:", err.message);
  }
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json()); // permet de lire le JSON envoyé dans le body des requêtes

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// "Base de données" temporaire, en mémoire

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token manquant" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token invalide ou expiré" });
  }
}

// READ — toutes les tâches
app.get("/tasks", requireAuth, async (req, res) => {
  const tasks = await prisma.task.findMany();
  res.json(tasks);
});

// READ — une seule tâche
app.get("/tasks/:id", requireAuth, async (req, res) => {
  const task = await prisma.task.findUnique({
    where: { id: Number(req.params.id) },
  });
  if (!task) return res.status(404).json({ error: "Tâche introuvable" });
  res.json(task);
});

// CREATE
app.post("/tasks", requireAuth, async (req, res) => {
  const { title, projectId, assigneeId, priority, dueDate, description } = req.body;
  if (!title || !projectId) {
    return res.status(400).json({ error: "Le titre et le projet sont requis" });
  }

  try {
    const newTask = await prisma.task.create({
      data: {
        title,
        projectId: Number(projectId),
        assigneeId: assigneeId ? Number(assigneeId) : req.userId,
        priority: priority || "normal",
        dueDate: dueDate ? new Date(dueDate) : null,
        description: description || null,
      },
      include: {
        assignee: { select: { id: true, name: true, initials: true, color: true, email: true } },
        project: { select: { name: true } },
        subtasks: true,
        comments: true,
      },
    });

    sendTaskAssignedEmail(newTask.assignee.email, newTask.title, newTask.project.name);

    const { project, assignee, ...taskFields } = newTask;
    const { email, ...assigneeWithoutEmail } = assignee;
    res.status(201).json({ ...taskFields, assignee: assigneeWithoutEmail });
  } catch (err) {
    res.status(400).json({ error: "Impossible de créer la tâche" });
  }
});

// UPDATE
app.put("/tasks/:id", requireAuth, async (req, res) => {
  const { title, done, assigneeId } = req.body;

  try {
    const task = await prisma.task.update({
      where: { id: Number(req.params.id) },
      data: {
        title,
        done,
        assigneeId: assigneeId ? Number(assigneeId) : undefined,
      },
      include: {
        assignee: { select: { email: true } },
        project: { select: { name: true } },
      },
    });

    if (assigneeId) {
      sendTaskAssignedEmail(task.assignee.email, task.title, task.project.name);
    }

    const { assignee, project, ...taskFields } = task;
    res.json(taskFields);
  } catch (err) {
    res.status(404).json({ error: "Tâche introuvable" });
  }
});

// GET /users — la liste des personnes assignables
app.get("/users", requireAuth, async (req, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, initials: true, color: true },
    orderBy: { name: "asc" },
  });
  res.json(users);
});

// DELETE
app.delete("/tasks/:id", requireAuth, async (req, res) => {
  try {
    await prisma.task.delete({
      where: { id: Number(req.params.id) },
    });
    res.status(204).send();
  } catch (err) {
    res.status(404).json({ error: "Tâche introuvable" });
  }
});

// UPDATE — cocher/décocher une sous-tâche
app.put("/subtasks/:id", requireAuth, async (req, res) => {
  const { done } = req.body;

  try {
    const subtask = await prisma.subtask.update({
      where: { id: Number(req.params.id) },
      data: { done },
    });
    res.json(subtask);
  } catch (err) {
    res.status(404).json({ error: "Sous-tâche introuvable" });
  }
});

// CREATE — ajouter une sous-tâche sur une tâche
app.post("/tasks/:id/subtasks", requireAuth, async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: "Le titre est requis" });

  try {
    const subtask = await prisma.subtask.create({
      data: { title, taskId: Number(req.params.id) },
    });
    res.status(201).json(subtask);
  } catch (err) {
    res.status(404).json({ error: "Tâche introuvable" });
  }
});

// CREATE — ajouter un commentaire sur une tâche
app.post("/tasks/:id/comments", requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "Le texte est requis" });

  try {
    const comment = await prisma.comment.create({
      data: {
        text,
        taskId: Number(req.params.id),
        authorId: req.userId,
      },
      include: {
        author: { select: { id: true, name: true, initials: true, color: true } },
      },
    });
    res.status(201).json(comment);
  } catch (err) {
    res.status(404).json({ error: "Tâche introuvable" });
  }
});

// CREATE — nouveau projet (équipe)
app.post("/projects", requireAuth, async (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: "Le nom est requis" });

  const project = await prisma.project.create({
    data: { name, color: color || "oklch(0.6 0.14 250)" },
  });
  res.status(201).json(project);
});

// GET /projects — tous les projets avec leurs tâches, sous-tâches, commentaires
app.get("/projects", requireAuth, async (req, res) => {
  const projects = await prisma.project.findMany({
    include: {
      tasks: {
        include: {
          assignee: {
            select: { id: true, name: true, initials: true, color: true },
          },
          subtasks: true,
          comments: {
            include: {
              author: {
                select: { id: true, name: true, initials: true, color: true },
              },
            },
          },
        },
      },
    },
  });
  res.json(projects);
});

// GET /projects/:id — un seul projet avec ses taches
app.get("/projects/:id", requireAuth, async (req, res) => {
  const project = await prisma.project.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      tasks: {
        include: {
          assignee: {
            select: { id: true, name: true, initials: true, color: true },
          },
          subtasks: true,
          comments: {
            include: {
              author: {
                select: { id: true, name: true, initials: true, color: true },
              },
            },
          },
        },
      },
    },
  });
  if (!project) return res.status(404).json({ error: "Projet introuvable" });
  res.json(project);
});

// GET /me — le profil de l'utilisateur connecte (via son token)
app.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, name: true, initials: true, color: true },
  });
  res.json(user);
});

const AVATAR_COLORS = [
  "oklch(0.56 0.19 276)",
  "oklch(0.65 0.15 30)",
  "oklch(0.6 0.14 200)",
  "oklch(0.62 0.16 320)",
  "oklch(0.75 0.13 70)",
];

function getInitials(name) {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// REGISTER — créer un compte
app.post("/register", async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: "Nom, email et mot de passe requis" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

  try {
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        initials: getInitials(name),
        color,
      },
    });
    res.status(201).json({ id: user.id, email: user.email, name: user.name });
  } catch (err) {
    res.status(400).json({ error: "Cet email est déjà utilisé" });
  }
});

// LOGIN — se connecter
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email et mot de passe requis" });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: "Email ou mot de passe incorrect" });
  }

  const passwordValid = await bcrypt.compare(password, user.password);
  if (!passwordValid) {
    return res.status(401).json({ error: "Email ou mot de passe incorrect" });
  }

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

  res.json({ token });
});

// Sur Vercel, l'app est exportée et Vercel gère le serveur ; en local on écoute sur PORT.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Serveur démarré sur http://localhost:${PORT}`);
  });
}

module.exports = app;
