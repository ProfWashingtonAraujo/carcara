// ===== NAVBAR SCROLL EFFECT =====
window.addEventListener('scroll', function() {
    const navbar = document.querySelector('.navbar');
    if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
});

// ===== SMOOTH SCROLLING PARA LINKS INTERNOS =====
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        
        const targetId = this.getAttribute('href');
        if (targetId === '#') return;
        
        const targetElement = document.querySelector(targetId);
        if (targetElement) {
            window.scrollTo({
                top: targetElement.offsetTop - 80,
                behavior: 'smooth'
            });
            
            // Fechar menu mobile após clique
            const navbarToggler = document.querySelector('.navbar-toggler');
            const navbarCollapse = document.querySelector('.navbar-collapse');
            if (navbarToggler && !navbarToggler.classList.contains('collapsed')) {
                navbarToggler.click();
            }
        }
    });
});

// ===== VALIDAÇÃO DO FORMULÁRIO =====
document.getElementById('contactForm').addEventListener('submit', function(e) {
    e.preventDefault();
    
    // Limpar validações anteriores
    clearValidation();
    
    const name = document.getElementById('name');
    const email = document.getElementById('email');
    const subject = document.getElementById('subject');
    const message = document.getElementById('message');
    
    let isValid = true;
    
    // Validação do nome
    if (!name.value.trim()) {
        showError(name, 'Por favor, insira seu nome.');
        isValid = false;
    }
    
    // Validação do email
    if (!email.value.trim()) {
        showError(email, 'Por favor, insira seu e-mail.');
        isValid = false;
    } else if (!isValidEmail(email.value)) {
        showError(email, 'Por favor, insira um e-mail válido.');
        isValid = false;
    }
    
    // Validação do assunto
    if (!subject.value.trim()) {
        showError(subject, 'Por favor, insira um assunto.');
        isValid = false;
    }
    
    // Validação da mensagem
    if (!message.value.trim()) {
        showError(message, 'Por favor, insira sua mensagem.');
        isValid = false;
    }
    
    if (isValid) {
        // Simulação de envio do formulário
        simulateFormSubmission();
    }
});

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
    const inputs = document.querySelectorAll('.form-control');
    inputs.forEach(input => {
        input.classList.remove('is-invalid');
    });
}

// Função para simular envio do formulário
function simulateFormSubmission() {
    const submitButton = document.querySelector('#contactForm button[type="submit"]');
    const originalText = submitButton.textContent;
    
    // Simular loading
    submitButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Enviando...';
    submitButton.disabled = true;
    
    // Simular delay de rede
    setTimeout(() => {
        // Sucesso no envio
        alert('Mensagem enviada com sucesso! Entraremos em contato em breve.');
        document.getElementById('contactForm').reset();
        
        // Restaurar botão
        submitButton.innerHTML = originalText;
        submitButton.disabled = false;
    }, 2000);
}

// ===== INICIALIZAÇÃO DO CAROUSEL =====
document.addEventListener('DOMContentLoaded', function() {
    const myCarousel = document.querySelector('#testimonialCarousel');
    if (myCarousel) {
        const carousel = new bootstrap.Carousel(myCarousel, {
            interval: 5000,
            wrap: true
        });
    }
});

// ===== ANIMAÇÃO AO SCROLL =====
// Observador de interseção para animações
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            // adiciona classe ao entrar
            entry.target.classList.add('animate-in');
        } else {
            // remove classe ao sair para permitir re-animação quando voltar
            entry.target.classList.remove('animate-in');
        }
    });
}, observerOptions);

// Observar elementos para animação
document.addEventListener('DOMContentLoaded', function() {
    const elementsToAnimate = document.querySelectorAll('.service-card, .portfolio-item, .testimonial-card');
    elementsToAnimate.forEach(element => {
        observer.observe(element);
    });
});