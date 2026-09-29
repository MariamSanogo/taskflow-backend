require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const bcrypt = require("bcrypt");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Debut du seed...");

  const hashedPassword = await bcrypt.hash("password123", 10);

  const aya = await prisma.user.create({
    data: {
      email: "aya@taskflow.com",
      password: hashedPassword,
      name: "Aya N'Dri",
      initials: "AN",
      color: "oklch(0.56 0.19 276)",
    },
  });

  const sarah = await prisma.user.create({
    data: {
      email: "sarah@taskflow.com",
      password: hashedPassword,
      name: "Sarah M.",
      initials: "SM",
      color: "oklch(0.65 0.15 30)",
    },
  });

  const julien = await prisma.user.create({
    data: {
      email: "julien@taskflow.com",
      password: hashedPassword,
      name: "Julien Dubois",
      initials: "JD",
      color: "oklch(0.6 0.14 200)",
    },
  });

  const awa = await prisma.user.create({
    data: {
      email: "awa@taskflow.com",
      password: hashedPassword,
      name: "Awa Koné",
      initials: "AK",
      color: "oklch(0.62 0.16 320)",
    },
  });

  console.log("4 utilisateurs crees");

  const projetSiteWeb = await prisma.project.create({
    data: {
      name: "Site Web — Client A",
      color: "oklch(0.56 0.19 276)",
      tasks: {
        create: [
          {
            title: "Recherche concurrentielle",
            done: true,
            priority: "normal",
            assigneeId: sarah.id,
            description:
              "Analyser les sites de 3 concurrents directs pour identifier les bonnes pratiques et les axes de différenciation.",
            subtasks: {
              create: [
                { title: "Lister les concurrents", done: true },
                { title: "Analyser leurs parcours d'achat", done: true },
              ],
            },
          },
          {
            title: "Concevoir la nouvelle page d'accueil",
            done: false,
            priority: "urgent",
            dueDate: new Date(),
            assigneeId: aya.id,
            description:
              "Créer une nouvelle maquette pour la page d'accueil, en s'appuyant sur la charte graphique validée avec le client.",
            subtasks: {
              create: [
                {
                  title: "Recueillir les références visuelles du client",
                  done: true,
                },
                { title: "Créer la section héro", done: false },
                { title: "Présenter la maquette en interne", done: false },
              ],
            },
            comments: {
              create: [
                {
                  text: "J'ai partagé le moodboard du client dans le dossier Drive, ça peut aider pour la direction artistique.",
                  authorId: julien.id,
                },
              ],
            },
          },
          {
            title: "Intégrer le formulaire de contact",
            done: false,
            priority: "normal",
            dueDate: new Date("2026-03-14"),
            assigneeId: julien.id,
            description:
              "Brancher le formulaire de contact sur l'API et ajouter la validation des champs.",
          },
        ],
      },
    },
  });

    const projetMobile = await prisma.project.create({
      data: {
        name: "Application Mobile",
        color: "oklch(0.62 0.13 200)",
        tasks: {
          create: [
            {
              title: "Mettre en place l'authentification JWT",
              done: false,
              priority: "urgent",
              dueDate: new Date("2026-03-16"),
              assigneeId: aya.id,
              description:
                "Ajouter la connexion par email/mot de passe avec émission et vérification de tokens JWT côté API.",
            },
            {
              title: "Tester la synchronisation hors-ligne",
              done: false,
              priority: "normal",
              dueDate: new Date("2026-03-20"),
              assigneeId: awa.id,
            },
          ],
        },
      },
    });

    const projetMarketing = await prisma.project.create({
      data: {
        name: "Marketing Q1",
        color: "oklch(0.75 0.13 70)",
        tasks: {
          create: [
            {
              title: "Rédiger le calendrier éditorial",
              done: false,
              priority: "normal",
              dueDate: new Date("2026-03-22"),
              assigneeId: awa.id,
            },
            {
              title: "Lancer la campagne réseaux sociaux",
              done: false,
              priority: "urgent",
              dueDate: new Date("2026-03-25"),
              assigneeId: sarah.id,
            },
          ],
        },
      },
    });

    console.log("Projets 'Mobile' et 'Marketing' crees");


  console.log("Projet 'Site Web' cree avec ses taches");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
