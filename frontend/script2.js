document.addEventListener('DOMContentLoaded', () => {
  // Determine which page we are currently on
  const isSignInPage = document.title.includes('Sign In');
  const isSignUpPage = document.title.includes('Sign Up');

  // ==========================================
  // SIGN IN PAGE LOGIC
  // ==========================================
  if (isSignInPage) {
    const signInForm = document.querySelector('form');
    
    signInForm.addEventListener('submit', (e) => {
      e.preventDefault(); // Stop page reload
      
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;

      if (email && password) {
         console.log(`[ForgeSight UI] Login request captured for: ${email}`);
         
         const btn = signInForm.querySelector('.btn-primary');
         const originalText = btn.innerText;
         btn.innerText = 'AUTHENTICATING...';
         
         setTimeout(() => {
           alert('Login simulated successfully! Redirecting to dashboard...');
           btn.innerText = originalText;
           // Route to main dashboard
           window.location.href = '/'; 
         }, 800);
      }
    });
  }

  // ==========================================
  // SIGN UP PAGE LOGIC
  // ==========================================
  if (isSignUpPage) {
    const signUpForm = document.querySelector('form');
    
    signUpForm.addEventListener('submit', (e) => {
      e.preventDefault(); 
      
      const fullname = document.getElementById('fullname').value;
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      const confirmPassword = document.getElementById('confirm-password').value;

      if (password !== confirmPassword) {
        alert('Validation Error: Passwords do not match.');
        document.getElementById('password').style.borderColor = '#ff4d4d';
        document.getElementById('confirm-password').style.borderColor = '#ff4d4d';
        setTimeout(() => {
          document.getElementById('password').style.borderColor = '';
          document.getElementById('confirm-password').style.borderColor = '';
        }, 2000);
        return;
      }

      if (fullname && email && password && confirmPassword) {
         console.log(`[ForgeSight UI] Registration request captured for: ${fullname}`);
         
         const btn = signUpForm.querySelector('.btn-primary');
         const originalText = btn.innerText;
         btn.innerText = 'REGISTERING...';
         
         setTimeout(() => {
           alert('Registration simulated successfully! Routing to Sign In...');
           btn.innerText = originalText;
           // Route to signin
           window.location.href = '/signin'; 
         }, 800);
      }
    });
  }

  // ==========================================
  // SOCIAL BUTTONS LOGIC (Both Pages)
  // ==========================================
  const socialButtons = document.querySelectorAll('.btn-social');
  
  socialButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault(); 
      const platform = btn.innerText.trim();
      console.log(`[ForgeSight UI] ${platform} clicked`);
      alert(`${platform} click registered! (UI Only)`);
    });
  });
});
