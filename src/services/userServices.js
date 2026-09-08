module.exports = function validateUser({
    cpf, 
    name, 
    email, 
    password, 
    cellphone, 
    birthday,
}){
    if(!cpf||!name||!email||!password||!cellphone||!birthday){
        return{error: "Todos os campos devem ser preenchidos"};
    }

    if(isNaN(cpf) || cpf.length !== 11){
        return{error: "CPF inválido. Deve conter 11 dígitos numéricos"};
    }

    if(!email.includes("@")){
        return{error: "Email inválido. Deve conter @"};
    }

    if(isNaN(cellphone)|| cellphone.length !== 11){
        return{error: "Telefone inválido. Deve conter 11 dígitos numéricos"}
    }

    return null;
}