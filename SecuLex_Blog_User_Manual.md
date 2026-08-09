# SecuLex: Official Content Management System Guide

Congratulations on launching the new SecuLex scholarly blog! This platform has been custom-built to be blazingly fast, highly secure, and incredibly easy to manage without writing any code.

This manual explains how to use your new Admin Dashboard to update your website.

---

## 1. Accessing Your Admin Dashboard

You have two different dashboards depending on whether you are editing locally on your computer or on the live internet.

- **Local Editing (Testing):** `http://localhost:8080/admin/`
- **Live Internet Editing:** `https://seculex-blog.netlify.app/admin/` (or your custom `.com` domain followed by `/admin/`)

When you log into the **Live Internet** dashboard for the first time, you will be prompted to connect your GitHub account or use your Email/Password.

---

## 2. Navigating the CMS Architecture

When you log into the dashboard, look at the left sidebar. You have four main **Collections** (think of these as filing cabinets):

1. **Category Manager:** Where you create topic labels.
2. **Articles:** Where you write your scholarly posts.
3. **Pages:** Where you edit the website's layout, colors, and global settings.
4. **Legal Policies:** Where you update the massive text walls for Privacy and Terms.

---

## 3. Creating & Managing Categories

Before writing an article, you must ensure its topic category exists.

1. Click on the **Category Manager** tab on the left.
2. Click **New Category Manager**.
3. Type the name of the topic (e.g., "Space Law" or "International Treaties").
4. Click **Publish**. 

Your new category will now permanently appear in the dropdown menu when you write articles!

---

## 4. Writing & Publishing Articles

1. Click on the **Articles** tab.
2. Click **New Articles**.
3. Fill out the fields:
   - **Title:** The headline of your article.
   - **Category:** Select a topic from your Category Manager dropdown.
   - **Author Image (Optional):** Upload a circular profile photo of yourself or a guest writer.
   - **Body:** This is the main text editor. You can use Bold, Italics, Links, and bullet points.
   - **Attachment (Optional):** If you have a PDF report, you can upload it here. A "Download Report" button will automatically appear inside the article!
4. Click **Publish**.

*Note: Every article automatically generates a Discus Comment Section at the bottom for your readers.*

---

## 5. Changing the Website Theme Colors

Your entire website's appearance is wired into the dashboard so you can pivot designs easily.

1. Click on the **Pages** tab.
2. Select **Theme Editor (Colors)**.
3. Click on the colored squares to open the visual palette.
4. Drag your mouse to choose new Web Hex colors for the backgrounds, the text, and the elegant gold accents.
5. Click **Publish**. The layout colors will instantly change across the entire website.

---

## 6. Editing the Homepage & "About" Section

The text on your homepage is never stuck.

1. Click on the **Pages** tab.
2. Select **Home Page** to change the massive Hero Welcome text and images.
3. Select **About Section** to change the biography text. Here you can also upload a **Profile Photo** which will replace the generic 'Scales of Justice' badge on the homepage with a beautiful portrait of you!

---

## 7. Editing Footer Links & Site Settings

1. Click on the **Pages** tab.
2. Select **Site Settings & Contact**.
3. Scroll down here to change the Website Title, Copyright Year, Contact Email, and Twitter Links.
4. At the very bottom, you will see a list of **Footer Themes**. You can click "Add" to generate more links for the bottom of your website.

---

## 8. Pushing Local Updates Live to the Internet

If you are using the *Local* dashboard (`localhost:8080`), your changes only happen on your computer. To beam them to the live website:

1. Go to your repository: `https://github.com/Bizimanakg/seculex-blog`
2. Click **Add file > Upload files**.
3. Drag your `src` folder, `package.json`, and `.eleventy.js` from `C:\blog_website\` into the browser.
4. Click **Commit changes**.

Netlify will detect the new files and build your live site within 60 seconds!

*(Note: If you use the Live Admin dashboard URL instead, you do not need to drag and drop! Clicking "Publish" makes it live instantly).*
