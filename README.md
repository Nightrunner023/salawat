# Ṣalawāt · compteur hebdomadaire

Une petite application (PWA) pour compter ses ṣalawāt semaine après semaine.
On se connecte avec son compte Google : les comptes sont sauvegardés sur le
serveur et se retrouvent sur n'importe quel appareil, même après avoir vidé
le navigateur.

Ce qu'elle fait : saisie libre du nombre de ṣalawāt (plusieurs fois par jour
si besoin), vue des 7 jours de la semaine avec le total, bouton « Clôturer la
semaine » qui enregistre le total dans l'historique et remet le compteur à
zéro, choix du jour où commence sa semaine (vendredi par défaut), annulation
de la dernière saisie du jour. Si on oublie de clôturer, les semaines passées
sont archivées automatiquement, rien ne se perd.

---

## 1. Créer l'identifiant Google (une fois, gratuit)

C'est ce qui permet le bouton « Se connecter avec Google ». Comme la clé
GoldAPI de Nissab du Jour : une démarche unique, puis on colle une valeur
dans `.env`.

1. Allez sur https://console.cloud.google.com et connectez-vous avec votre
   compte Google.
2. En haut, ouvrez le sélecteur de projet puis **New project**. Nommez-le
   par exemple `salawat`, créez, et vérifiez qu'il est bien sélectionné.
3. Menu de gauche → **APIs & Services** → **OAuth consent screen**.
   - Choisissez **External**, puis remplissez le minimum : nom de l'app
     (`Salawat`), votre email dans les deux champs demandés. Enregistrez
     les étapes suivantes sans rien ajouter (pas de scopes à ajouter).
   - À la fin, sur la page du consent screen, cliquez **Publish app**
     (statut « In production »). Sans cela, seuls des comptes de test
     pourraient se connecter.
4. Menu de gauche → **Credentials** → **Create credentials** →
   **OAuth client ID**.
   - Application type : **Web application**.
   - Name : `salawat-web`.
   - **Authorized JavaScript origins** : ajoutez ces deux lignes
     - `https://salawat.nissabdujour.fr`
     - `http://localhost:3001` (pour tester en local)
   - Pas besoin de « redirect URIs ». Créez.
5. Copiez le **Client ID** affiché (il se termine par
   `.apps.googleusercontent.com`). C'est lui qui va dans `.env`.

## 2. Tester en local (facultatif)

Sur votre ordinateur, dans le dossier du projet :

```bash
npm install
cp .env.example .env
```

Ouvrez `.env`, collez votre Client ID après `GOOGLE_CLIENT_ID=`, puis :

```bash
npm start
```

Ouvrez http://localhost:3001 : l'écran de connexion s'affiche, le bouton
Google fonctionne, et après connexion vous voyez le compteur.

## 3. Créer le sous-domaine (chez LWS)

Dans la **Zone DNS** de `nissabdujour.fr` (la même page que la dernière
fois), ajoutez un enregistrement :

- **Type** : A
- **Nom** : `salawat`
- **Valeur** : `15.188.128.34` (l'IP fixe du serveur)
- TTL : valeur par défaut

Pour vérifier la propagation, sur le serveur : `dig +short salawat.nissabdujour.fr`
doit renvoyer l'IP.

## 4. Déposer le code sur le serveur

Créez un **nouveau dépôt GitHub** (par exemple `salawat`, public), uploadez
tous les fichiers du projet (glissez le dossier `public` entier et les
fichiers à la racine), commit sur `main`.

Puis, dans la console SSH du serveur (commandes une par une) :

```bash
cd ~
git clone https://github.com/VOTRE-NOM/salawat.git
cd salawat
npm install --omit=dev
cp .env.example .env
nano .env        # collez le Client ID, Ctrl+O, Entrée, Ctrl+X
pm2 start ecosystem.config.js
pm2 save
```

Vérification : `curl http://localhost:3001/healthz` doit répondre `ok`.

## 5. Brancher le HTTPS (Caddy)

Cette fois, il faut ajouter un bloc au fichier de Caddy (celui du système,
qu'on n'avait plus touché depuis l'installation) :

```bash
sudo nano /etc/caddy/Caddyfile
```

Ajoutez **à la fin du fichier**, sous le bloc existant de nissabdujour.fr :

```
salawat.nissabdujour.fr {
    encode gzip zstd
    reverse_proxy 127.0.0.1:3001
}
```

Enregistrez (Ctrl+O, Entrée, Ctrl+X), puis :

```bash
sudo systemctl reload caddy
```

Caddy obtient le certificat tout seul. Ouvrez
https://salawat.nissabdujour.fr : c'est en ligne.

## 6. Mettre à jour plus tard

Comme pour Nissab du Jour :

```bash
cd ~/salawat
git fetch origin
git reset --hard origin/main
npm install --omit=dev
pm2 restart salawat
```

Si `style.css` ou `app.js` ont changé, pensez à augmenter la version dans
`public/sw.js` (`salawat-v1` → `salawat-v2`) avant l'upload.

## Notes

- Les données vivent dans `data/salawat.db` sur le serveur (ignoré par Git).
  Pensez aux **instantanés Lightsail** pour la sauvegarde : ce fichier
  contient désormais les comptes de vos utilisateurs.
- Si `npm install` échouait sur `better-sqlite3` (rare), installez les
  outils de compilation puis relancez :
  `sudo apt-get install -y build-essential python3`
- L'app n'utilise que le nom et l'email fournis par Google, rien d'autre,
  et aucun mot de passe n'est stocké.
