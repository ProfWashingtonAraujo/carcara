// Página de envio de depoimento: o token do convite vem no fragmento (#...), que o navegador não envia ao servidor
const $ = id => document.getElementById(id);
const token = location.hash.slice(1);
history.replaceState(null, '', location.pathname); // tira o token da barra de endereço

const show = id => { for (const s of ['loading', 'invalid', 'done', 'form']) $(s).hidden = s !== id; };

async function start() {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return show('invalid');
    try {
        const res = await fetch(`/api/testimonials/invite/${token}`);
        if (!res.ok) return show('invalid');
        const { name } = await res.json();
        $('who').textContent = name;
        $('author_name').value = name;
        show('form');
    } catch {
        show('invalid');
    }
}

// recorta o centro em quadrado e reduz para 200 px: a foto fica leve e o servidor só recebe a versão reduzida
let photo = null;
function resizeImage(file, size = 200) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const side = Math.min(img.width, img.height);
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler a imagem.')); };
        img.src = url;
    });
}

$('photo').addEventListener('change', async () => {
    const file = $('photo').files[0];
    photo = null;
    $('preview').hidden = true;
    $('error').hidden = true;
    if (!file) return;
    try {
        photo = await resizeImage(file);
        $('preview').src = photo;
        $('preview').hidden = false;
    } catch (err) {
        $('error').textContent = `${err.message} Escolha uma foto JPG, PNG ou WebP.`;
        $('error').hidden = false;
        $('photo').value = '';
    }
});

$('body').addEventListener('input', () => { $('counter').textContent = `${$('body').value.length} / 600`; });

$('form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const error = $('error');
    error.hidden = true;
    const fail = msg => { error.textContent = msg; error.hidden = false; };
    const body = $('body').value.trim();
    if (!$('author_name').value.trim()) return fail('Informe o seu nome.');
    if (body.length < 20) return fail('Escreva um pouco mais: o depoimento precisa ter ao menos 20 caracteres.');
    if (!$('consent').checked) return fail('Marque a autorização para podermos publicar o depoimento.');
    $('send').disabled = true;
    try {
        const res = await fetch(`/api/testimonials/invite/${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ author_name: $('author_name').value, author_role: $('author_role').value, body, photo, consent: true })
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 404) return show('invalid');
        if (!res.ok) return fail(data.error || 'Não foi possível enviar. Tente novamente.');
        show('done');
    } catch {
        fail('Sem conexão com o servidor. Tente novamente em instantes.');
    } finally {
        $('send').disabled = false;
    }
});

start();
