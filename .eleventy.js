module.exports = function(eleventyConfig) {
  // Custom date filter for clean display like "April 5, 2026"
  eleventyConfig.addFilter("readableDate", (dateObj) => {
    const d = new Date(dateObj);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  });

  // Filter a collection by post category (supports nested data.category)
  eleventyConfig.addFilter("filterByCategory", (posts, category) => {
    return (posts || []).filter(post => post.data && post.data.category === category);
  });

  // Sort categories by numeric order property, then by title
  eleventyConfig.addFilter("sortCategories", (categoriesObj) => {
    if (!categoriesObj) return [];
    const entries = Object.entries(categoriesObj).map(([key, value]) => ({
      key,
      ...value,
      order: typeof value.order === 'number' ? value.order : 99
    }));
    entries.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    return entries;
  });

  eleventyConfig.addFilter("absoluteUrl", (url, base) => {
    if (!url) return base || "";
    if (/^https?:\/\//.test(url)) return url;
    const cleanBase = (base || "").replace(/\/$/, "");
    const cleanUrl = String(url).startsWith("/") ? url : `/${url}`;
    return `${cleanBase}${cleanUrl}`;
  });

  eleventyConfig.addFilter("thousands", (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return value || "";
    return num.toLocaleString('en-US');
  });

  eleventyConfig.addFilter("fileName", (url) => {
    if (!url) return "";
    return String(url).split(/[\\/]/).filter(Boolean).pop() || "";
  });

  eleventyConfig.addFilter("extractTOC", (htmlContent) => {
    if (!htmlContent) return "";
    const regex = /<h([2-3])[^>]*>(.*?)<\/h\1>/g;
    let match;
    let tocHtml = '<ul class="toc-list">';
    let count = 0;
    
    while ((match = regex.exec(htmlContent)) !== null) {
      const level = match[1];
      const text = match[2].replace(/<[^>]+>/g, "");
      const indentClass = level === "3" ? "toc-item--indent" : "";
      tocHtml += `<li class="toc-item ${indentClass}"><span class="toc-bullet">•</span> <span class="toc-text">${text}</span></li>`;
      count++;
    }
    tocHtml += "</ul>";
    
    if (count === 0) {
      return '<p class="no-toc">No sections available.</p>';
    }
    return tocHtml;
  });

  eleventyConfig.addFilter("hexToRgb", (hex) => {
    const value = String(hex || "").trim().replace("#", "");
    const normalized = value.length === 3
      ? value.split("").map(char => char + char).join("")
      : value;
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return "8, 13, 81";
    const number = parseInt(normalized, 16);
    return `${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}`;
  });

  // Pass through assets and admin files directly to the compiled site
  eleventyConfig.addPassthroughCopy("src/css");
  eleventyConfig.addPassthroughCopy("src/js");
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy("src/admin");

  eleventyConfig.on("eleventy.after", () => {
    const fs = require("fs");
    const path = require("path");
    try {
      const manifestPath = path.resolve(__dirname, "protected_documents/paywall_manifest.json");
      const paywallJsonPath = path.resolve(__dirname, "src/_data/paywall.json");
      const postsDir = path.resolve(__dirname, "src/posts");

      let paywallEnabled = true;
      if (fs.existsSync(paywallJsonPath)) {
        const paywallConfig = JSON.parse(fs.readFileSync(paywallJsonPath, "utf8"));
        paywallEnabled = paywallConfig.enabled !== false;
      }

      const freeDocuments = [];

      if (fs.existsSync(postsDir)) {
        const files = fs.readdirSync(postsDir);
        for (const file of files) {
          if (file.endsWith(".md")) {
            const content = fs.readFileSync(path.join(postsDir, file), "utf8");
            
            let attachment = "";
            const attachmentMatch = content.match(/attachment:\s*["']?([A-Za-z0-9._-]+\.pdf)["']?/);
            if (attachmentMatch) {
              attachment = attachmentMatch[1].trim();
            }
            const protectedMatch = content.match(/protected_attachment:\s*["']?.*?([A-Za-z0-9._-]+\.pdf)["']?/);
            if (protectedMatch) {
              attachment = protectedMatch[1].trim();
            }

            if (attachment) {
              const paywallEnabledMatch = content.match(/paywall_enabled:\s*(\w+)/);
              const isPaid = paywallEnabledMatch && paywallEnabledMatch[1].trim() === "true";
              if (!isPaid) {
                freeDocuments.push(attachment);
              }
            }
          }
        }
      }

      const manifest = {
        paywallEnabled,
        freeDocuments,
      };

      const manifestDir = path.dirname(manifestPath);
      if (!fs.existsSync(manifestDir)) {
        fs.mkdirSync(manifestDir, { recursive: true });
      }

      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
      console.log("[Eleventy] Generated paywall manifest:", manifest);

      // Prune stale compiled posts that no longer have a source markdown file
      const sitePostsDir = path.resolve(__dirname, "_site/posts");
      if (fs.existsSync(sitePostsDir) && fs.existsSync(postsDir)) {
        const sitePostFolders = fs.readdirSync(sitePostsDir);
        for (const folder of sitePostFolders) {
          const sourceFile = path.join(postsDir, `${folder}.md`);
          if (!fs.existsSync(sourceFile)) {
            const folderPath = path.join(sitePostsDir, folder);
            fs.rmSync(folderPath, { recursive: true, force: true });
            console.log(`[Eleventy] Pruned deleted article from output: ${folder}`);
          }
        }
      }
    } catch (err) {
      console.error("[Eleventy] Failed in post-build hook:", err);
    }
  });

  return {
    dir: {
      input: "src",    
      output: "_site", 
      includes: "_includes"
    }
  };
};
