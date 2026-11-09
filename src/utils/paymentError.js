module.exports = function paymentError(message, status = 500) {
    const error = new Error(message);
    error.status = status;
    return error;
};
