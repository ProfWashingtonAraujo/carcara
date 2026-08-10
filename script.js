// ===== NAVBAR SCROLL EFFECT =====
window.addEventListener('scroll', function() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
});

// ===== SMOOTH SCROLLING PARA LINKS INTERNOS =====
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        const targetId = this.getAttribute('href');
        if (targetId === '#') return;
        
        const targetElement = document.querySelector(targetId);
        if (targetElement) {
            e.preventDefault();

            window.scrollTo({
                top: targetElement.offsetTop - 80,
                behavior: 'smooth'
            });
            
            // Fechar menu mobile após clique
            const navbarToggler = document.querySelector('.navbar-toggler');
            if (navbarToggler && !navbarToggler.classList.contains('collapsed')) {
                navbarToggler.click();
            }
        }
    });
});

// ===== VALIDAÇÃO DO FORMULÁRIO =====
const contactForm = document.getElementById('contactForm');

if (contactForm) {
    contactForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        clearValidation();

        const email = document.getElementById('email');
        let isValid = true;

        contactForm.querySelectorAll('[required]').forEach(field => {
            if (!field.value.trim()) {
                field.classList.add('is-invalid');
                isValid = false;
            }
        });

        if (email.value.trim() && !isValidEmail(email.value)) {
            showError(email, 'Por favor, insira um e-mail válido.');
            isValid = false;
        }

        if (isValid) {
            await submitContactForm();
        }
    });
}

// Função para validar formato de email
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Função para mostrar erro de validação
function showError(input, message) {
    input.classList.add('is-invalid');
    
    let feedback = input.nextElementSibling;
    if (!feedback || !feedback.classList.contains('invalid-feedback')) {
        feedback = document.createElement('div');
        feedback.className = 'invalid-feedback';
        input.parentNode.insertBefore(feedback, input.nextSibling);
    }
    
    feedback.textContent = message;
}

// Função para limpar validações
function clearValidation() {
    const inputs = contactForm.querySelectorAll('.form-control, .form-select');
    inputs.forEach(input => {
        input.classList.remove('is-invalid');
    });

    const existingAlert = document.querySelector('.form-alert');
    if (existingAlert) {
        existingAlert.remove();
    }
}

// Envia os dados sem tirar o visitante da página
async function submitContactForm() {
    const submitButton = contactForm.querySelector('button[type="submit"]');
    const originalText = submitButton.innerHTML;

    submitButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Enviando...';
    submitButton.disabled = true;

    try {
        const endpoint = contactForm.action.replace('formsubmit.co/', 'formsubmit.co/ajax/');
        const response = await fetch(endpoint, {
            method: 'POST',
            body: new FormData(contactForm),
            headers: { Accept: 'application/json' }
        });
        const result = await response.json();

        if (!response.ok || (result.success !== true && result.success !== 'true')) {
            throw new Error('Não foi possível enviar o formulário.');
        }

        const alert = document.createElement('div');
        alert.className = 'alert alert-success form-alert mt-3';
        alert.setAttribute('role', 'status');
        alert.textContent = 'Solicitação enviada com sucesso. Entraremos em contato em até 1 dia útil.';

        contactForm.reset();
        contactForm.appendChild(alert);
    } catch (error) {
        const alert = document.createElement('div');
        alert.className = 'alert alert-danger form-alert mt-3';
        alert.setAttribute('role', 'alert');
        alert.textContent = 'Não foi possível enviar agora. Tente novamente ou entre em contato pelo telefone.';
        contactForm.appendChild(alert);
    } finally {
        submitButton.innerHTML = originalText;
        submitButton.disabled = false;
    }
}

// ===== INICIALIZAÇÃO DO CAROUSEL =====
document.addEventListener('DOMContentLoaded', function() {
    const currentYear = document.getElementById('currentYear');
    if (currentYear) {
        currentYear.textContent = new Date().getFullYear();
    }

    const projectDetailModal = document.getElementById('projectDetailModal');
    if (projectDetailModal) {
        projectDetailModal.addEventListener('show.bs.modal', function(event) {
            const button = event.relatedTarget;
            if (!button) return;

            const title = button.getAttribute('data-title') || 'Detalhes do projeto';
            const language = button.getAttribute('data-language') || 'Projeto';
            const image = button.getAttribute('data-image') || '';
            const description = button.getAttribute('data-description') || '';
            const details = button.getAttribute('data-details') || '';
            const github = button.getAttribute('data-github') || '#';
            const demo = button.getAttribute('data-demo');

            document.getElementById('projectDetailModalLabel').textContent = title;
            document.getElementById('projectDetailLanguage').textContent = language;
            document.getElementById('projectDetailDescription').textContent = description;
            document.getElementById('projectDetailText').textContent = details;

            const imageElement = document.getElementById('projectDetailImage');
            imageElement.src = image;
            imageElement.alt = `Prévia do projeto ${title}`;

            document.getElementById('projectDetailGithub').href = github;

            const demoLink = document.getElementById('projectDetailDemo');
            if (demo) {
                demoLink.href = demo;
                demoLink.classList.remove('d-none');
            } else {
                demoLink.classList.add('d-none');
            }
        });
    }

    const myCarousel = document.querySelector('#testimonialCarousel');
    if (myCarousel) {
        new bootstrap.Carousel(myCarousel, {
            interval: 5000,
            wrap: true
        });
    }
});

// ===== ANIMAÇÃO AO SCROLL (Intersection Observer) =====
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            // adiciona classe ao entrar
            entry.target.classList.add('animate-in');
            entry.target.classList.add('revealed');
            
            // Animar números se for a métrica
            if (entry.target.classList.contains('hero-metrics') && !entry.target.classList.contains('counted')) {
                animateNumbers();
                entry.target.classList.add('counted');
            }
        }
        // Removemos o 'else' para que os elementos não sumam ao voltar o scroll, melhorando a performance
    });
}, observerOptions);

// Observar elementos para animação
document.addEventListener('DOMContentLoaded', function() {
    const elementsToAnimate = document.querySelectorAll('.service-card, .project-card, .portfolio-item, .testimonial-card, .reveal, .hero-metrics');
    elementsToAnimate.forEach(element => {
        observer.observe(element);
    });

    initScrollProgress();
    initCursorGlow();
    initRippleEffect();
});

// ===== BARRA DE PROGRESSO DO SCROLL =====
function initScrollProgress() {
    const progressBar = document.createElement('div');
    progressBar.className = 'scroll-progress';
    document.body.appendChild(progressBar);

    window.addEventListener('scroll', () => {
        const windowHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        const scrolled = (window.scrollY / windowHeight) * 100;
        progressBar.style.width = `${scrolled}%`;
    });
}

// ===== CURSOR GLOW NO HERO =====
function initCursorGlow() {
    const hero = document.querySelector('.hero');
    if (!hero) return;

    const glow = document.createElement('div');
    glow.className = 'cursor-glow';
    hero.appendChild(glow);

    hero.addEventListener('mousemove', (e) => {
        const rect = hero.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        glow.style.left = `${x}px`;
        glow.style.top = `${y}px`;
        glow.style.opacity = '1';
    });

    hero.addEventListener('mouseleave', () => {
        glow.style.opacity = '0';
    });
}

// ===== EFEITO RIPPLE NOS BOTÕES =====
function initRippleEffect() {
    const buttons = document.querySelectorAll('.btn-primary');
    
    buttons.forEach(button => {
        button.addEventListener('click', function(e) {
            const x = e.clientX - e.target.getBoundingClientRect().left;
            const y = e.clientY - e.target.getBoundingClientRect().top;
            
            const ripple = document.createElement('span');
            ripple.className = 'btn-ripple-wave';
            ripple.style.left = `${x}px`;
            ripple.style.top = `${y}px`;
            
            this.appendChild(ripple);
            
            setTimeout(() => {
                ripple.remove();
            }, 600);
        });
    });
}

// ===== ANIMAÇÃO DE NÚMEROS (CountUp) =====
function animateNumbers() {
    const counters = document.querySelectorAll('[data-count]');
    
    counters.forEach(counter => {
        const target = +counter.getAttribute('data-count');
        const duration = 2000; // 2 segundos
        const step = target / (duration / 16); // 60fps
        let current = 0;
        
        const updateCounter = () => {
            current += step;
            if (current < target) {
                counter.innerText = Math.ceil(current);
                requestAnimationFrame(updateCounter);
            } else {
                counter.innerText = target;
            }
        };
        
        updateCounter();
    });
}
