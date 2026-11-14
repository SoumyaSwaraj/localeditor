/* Quick maker: a one-page CV. Name, title, contact, summary, experience, education and skills in four restrained
   styles on A4 or US Letter. The input limits and a shared shrink keep even a full form on one page (the tests build the longest case).
   A CV is one document, so this maker has no list button. */
(function () {
  'use strict';
  var LE = window.LE;
  if (!LE || !LE.makers) return;
  var M = LE.makers;

  var S = {
    classic: { ink: '#1E1D1B', muted: '#55524C', accent: '#1E1D1B', head: 'EB Garamond', headW: 700, body: 'EB Garamond', bodyK: 1.12, centre: 1 },
    modern: { ink: '#15171C', muted: '#555B66', accent: '#2450D8', head: 'Inter Tight', headW: 700, body: 'Inter', side: 1 },
    compact: { ink: '#16181D', muted: '#565B66', accent: '#0F6B5C', head: 'Source Sans 3', headW: 700, body: 'Source Sans 3', bodyK: 1.06 },
    accent: { ink: '#1B1B1F', muted: '#57565E', accent: '#9B2C2C', head: 'Fraunces', headW: 700, body: 'Inter', bar: 1 }
  };

  function go(K) {
    M.register({
      id: 'resume',
      name: 'CV on one page',
      category: 'Life',
      summary: 'A one-page CV or résumé: experience, education and skills, ready to save as a PDF.',
      keywords: ['cv', 'resume', 'résumé', 'curriculum vitae', 'job application', 'one page cv', 'career', 'work history', 'pdf'],
      sizes: ['a4', 'letter'],
      inputs: [
        { key: 'name', label: 'Name', type: 'text', required: true, max: 40, placeholder: 'Priya Nair' },
        { key: 'title', label: 'Job title', type: 'text', max: 60, placeholder: 'Product designer' },
        { key: 'contact', label: 'Contact details', type: 'list', max: 5, cellMax: 44, placeholder: 'priya@example.com', hint: 'One per line: email, phone, town, website.' },
        { key: 'summary', label: 'Summary', type: 'longtext', max: 420, maxLines: 6, placeholder: 'Two or three sentences about what you do well.' },
        { key: 'experience', label: 'Experience', type: 'list', columns: ['Role', 'Employer', 'Dates', 'What you did'], max: 5, cellMax: 200, hint: 'Newest first. Keep “What you did” to a sentence or two.' },
        { key: 'education', label: 'Education', type: 'list', columns: ['Course', 'Place and year'], max: 3, cellMax: 60 },
        { key: 'skills', label: 'Skills', type: 'list', max: 10, cellMax: 28, placeholder: 'User research' },
        { key: 'photo', label: 'Photo', type: 'photo', hint: 'Optional. Many employers prefer a CV without one.' },
        { key: 'accent', label: 'Colour', type: 'color' }
      ],
      styles: [{ id: 'classic', name: 'Classic' }, { id: 'modern', name: 'Side column' }, { id: 'compact', name: 'Compact' }, { id: 'accent', name: 'Accent' }],
      sample: { values: { name: 'Priya Nair', title: 'Product designer', contact: ['priya@example.com', '+44 20 7946 0101', 'Manchester', 'priyanair.example'],
        summary: 'Designer with eight years in health and finance products. I turn tangled workflows into calm, clear screens, and I like working closely with engineers and the people who use what we build.',
        experience: [['Senior product designer', 'Northwind Health', '2022 – now', 'Led the redesign of the booking flow used by 400 clinics. Cut the steps to book from nine to four and set up the team’s design system.'],
          ['Product designer', 'Harbour Bank', '2018 – 2022', 'Designed the mobile onboarding and card controls. Ran monthly usability sessions and wrote the accessibility guide.'],
          ['Junior designer', 'Kiln Studio', '2016 – 2018', 'Websites and brand work for small businesses, from first sketch to launch.']],
        education: [['BA Graphic Design, first class', 'University of Leeds, 2016'], ['Certificate in Human–Computer Interaction', 'Open course, 2019']],
        skills: ['User research', 'Interaction design', 'Prototyping', 'Design systems', 'Accessibility', 'Workshop facilitation', 'HTML and CSS'] } },
      build: function (v, env) {
        var W = env.W, H = env.H, C = env.color, mm = env.print.mm, style = env.style;
        var T = Object.assign({}, S[style] || S.classic);
        if (v.accent) T.accent = v.accent;
        var u = mm(1), ink = T.ink, muted = T.muted, acc = C.ensure(T.accent, '#FFFFFF', 4.5), bk = T.bodyK || 1, B = 3.35 * u * bk;
        var page = env.page('#FFFFFF'), L = [], mx = 18 * u, my = 16 * u, al = T.centre ? 'center' : 'left';
        var contact = (v.contact || []).filter(Boolean), skills = (v.skills || []).filter(Boolean);
        var exp = (v.experience || []).filter(function (r) { return r && (r[0] || r[1]); }), edu = (v.education || []).filter(function (r) { return r && (r[0] || r[1]); });

        function sec(title) { return { id: 'section', name: title, text: title, font: T.body, weight: 700, size: 2.55 * u * bk, min: 2.1 * u, maxLines: 1, uppercase: true, tracking: 0.16, color: acc, gap: 2 * u }; }
        function gap(h) { return { h: h * u, make: function () { return null; } }; }
        function rule(w) { return { h: Math.max(2, 0.25 * u), fixed: true, gap: 4 * u, make: function (x, y, bw) { var rw = w ? Math.min(bw, w * u) : bw; return env.line({ id: 'rule', name: 'Rule', x: T.centre ? x + (bw - rw) / 2 : x, y: y, w: rw, width: Math.max(2, 0.25 * u), color: T.centre ? ink : C.mix('#FFFFFF', ink, 0.25) }); } }; }
        function body(w) {
          var out = [];
          if (v.summary) out.push(sec('Profile'), { id: 'summary', name: 'Summary', text: v.summary, font: T.body, weight: 400, size: B, min: 2.5 * u, maxLines: 9, lineHeight: 1.42, color: ink, gap: 5.5 * u, input: 'summary' });
          if (exp.length) {
            out.push(sec('Experience'));
            exp.forEach(function (r, i) {
              out.push({ id: 'role-' + (i + 1), name: 'Role ' + (i + 1), text: [r[0], r[1]].filter(Boolean).join(' · '), font: T.body, weight: 700, size: B * 1.04, min: 2.5 * u, maxLines: 2, lineHeight: 1.25, color: ink, gap: 0.5 * u, input: 'experience' });
              if (r[2]) out.push({ id: 'dates-' + (i + 1), name: 'Dates ' + (i + 1), text: r[2], font: T.body, weight: 400, italic: !!T.centre, size: B * 0.9, min: 2.3 * u, maxLines: 1, color: muted, gap: 1 * u });
              if (r[3]) out.push({ id: 'did-' + (i + 1), name: 'What you did ' + (i + 1), text: r[3], font: T.body, weight: 400, size: B, min: 2.5 * u, maxLines: 5, lineHeight: 1.4, color: ink, gap: 0, input: 'experience' });
              out.push(gap(i === exp.length - 1 ? 5.5 : 3.6));
            });
          }
          if (edu.length) {
            out.push(sec('Education'));
            edu.forEach(function (r, i) {
              out.push({ id: 'course-' + (i + 1), name: 'Course ' + (i + 1), text: r[0] || r[1], font: T.body, weight: 700, size: B * 1.02, min: 2.5 * u, maxLines: 2, lineHeight: 1.25, color: ink, gap: 0.4 * u, input: 'education' });
              if (r[0] && r[1]) out.push({ id: 'school-' + (i + 1), name: 'Place ' + (i + 1), text: r[1], font: T.body, weight: 400, size: B * 0.94, min: 2.4 * u, maxLines: 2, color: muted, gap: 0 });
              out.push(gap(i === edu.length - 1 ? 5.5 : 2.6));
            });
          }
          return out;
        }
        function skillItems(inline) {
          if (!skills.length) return [];
          if (inline) return [sec('Skills'), { id: 'skills', name: 'Skills', text: skills.join('  ·  '), font: T.body, weight: 400, size: B, min: 2.5 * u, maxLines: 4, lineHeight: 1.5, color: ink, input: 'skills' }];
          return [sec('Skills')].concat(skills.map(function (s, i) { return { id: 'skill-' + (i + 1), name: 'Skill ' + (i + 1), text: s, font: T.body, weight: 400, size: B * 0.96, min: 2.4 * u, maxLines: 2, lineHeight: 1.25, color: ink, gap: 1.3 * u, input: 'skills' }; }));
        }
        function head(size) {
          return [
            { id: 'name', name: 'Name', text: v.name, font: T.head, weight: T.headW, size: size * u, min: 5 * u, maxLines: 2, lineHeight: 1.05, tracking: T.centre ? 0.02 : -0.01, color: ink, gap: 1.2 * u, input: 'name' },
            v.title ? { id: 'title', name: 'Job title', text: v.title, font: T.body, weight: T.centre ? 400 : 700, italic: !!T.centre, size: 4 * u * bk, min: 2.8 * u, maxLines: 2, color: acc, gap: 3 * u, input: 'title' } : null
          ];
        }
        var opt = { align: al, valign: 'top', minScale: 0.76, clip: true };
        if (T.side) {
          /* A tinted column on the left for the photo, contact details and skills; the story on the right. */
          var sw = 62 * u, tint = C.mix('#FFFFFF', acc, 0.07);
          L.push(env.rect({ id: 'side', name: 'Side column', x: 0, y: 0, w: sw, h: H, fill: tint }));
          var side = [
            v.photo ? { h: 34 * u, fixed: true, gap: 6 * u, make: function (x, y, w, h) { return env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: x, y: y, w: h, h: h, mask: 'ellipse', label: 'Photo' }); } } : null,
            contact.length ? sec('Contact') : null
          ].concat(contact.map(function (c, i) { return { id: 'contact-' + (i + 1), name: 'Contact ' + (i + 1), text: c, font: T.body, weight: 400, size: B * 0.94, min: 2.3 * u, maxLines: 2, lineHeight: 1.25, color: ink, gap: 1.3 * u, input: 'contact' }; }), [gap(5)], skillItems(false));
          L = L.concat(K.stack(env, { x: 12 * u, y: my, w: sw - 22 * u, h: H - 2 * my }, side, opt).layers);
          L = L.concat(K.stack(env, { x: sw + 12 * u, y: my, w: W - sw - 12 * u - mx, h: H - 2 * my }, head(9.4).concat([gap(3)], body()), opt).layers);
        } else {
          var cw = W - 2 * mx, top = head(T.centre ? 10.5 : 9.6);
          if (contact.length) top.push({ id: 'contact', name: 'Contact details', text: contact.join('  ·  '), font: T.body, weight: 400, size: B * 0.96, min: 2.4 * u, maxLines: 2, lineHeight: 1.35, color: muted, gap: 4 * u, input: 'contact' });
          if (T.bar) L.push(env.rect({ id: 'bar', name: 'Accent bar', x: 0, y: 0, w: W, h: 5 * u, fill: acc }));
          var px = 30 * u, hasPhoto = !!v.photo && !T.centre;
          if (hasPhoto) L.push(env.photo({ id: 'photo', name: 'Photo', src: v.photo, x: W - mx - px, y: my + (T.bar ? 4 * u : 0), w: px, h: px, mask: 'ellipse', label: 'Photo' }));
          var y0 = my + (T.bar ? 4 * u : 0);
          var st = K.stack(env, { x: mx, y: y0, w: cw - (hasPhoto ? px + 8 * u : 0), h: 60 * u }, top.concat([rule(T.centre ? 0 : 0)]), { align: al, valign: 'top', minScale: 0.7 });
          L = L.concat(st.layers);
          var by = Math.max(st.bottom, hasPhoto ? y0 + px : 0) + 6 * u;
          if (style === 'compact') {
            /* Two columns under the header: the story wide on the left, education and skills on the right. */
            var rw = cw * 0.3, g = 9 * u, wide = [], narrow = [];
            body().forEach(function (it) { wide.push(it); });
            var cut = wide.findIndex(function (it) { return it && it.text === 'Education'; });
            if (cut >= 0) narrow = wide.splice(cut);
            L = L.concat(K.stack(env, { x: mx, y: by, w: cw - rw - g, h: H - my - by }, wide, opt).layers);
            L = L.concat(K.stack(env, { x: mx + cw - rw, y: by, w: rw, h: H - my - by }, narrow.concat(skillItems(false)), opt).layers);
          } else L = L.concat(K.stack(env, { x: mx, y: by, w: cw, h: H - my - by }, body().concat(skillItems(true)), Object.assign({}, opt, { align: 'left' })).layers);
        }
        page.layers = L;
        return { name: 'CV — ' + v.name, pages: [page] };
      }
    });
  }
  if (M.kit) go(M.kit); else (M.kitWait = M.kitWait || []).push(go);
})();
